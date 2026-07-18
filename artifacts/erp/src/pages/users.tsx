import { useState, useEffect } from "react";
import { useGetUsers, useCreateUser, useUpdateUser, useGetRoles, useGetBranches, User, getGetUsersQueryKey } from "@workspace/api-client-react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Plus, Edit2, UserCircle, Trash2, Shield, Monitor, Smartphone, Clock, AlertTriangle, CheckCircle, XCircle, LogOut, RefreshCw, MapPin, ChevronDown, Save } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

interface WorkerOption { id: number; name: string; isActive: boolean; }

interface DeviceRecord {
  id: number; userId: number; fingerprint: string;
  deviceType: "mobile" | "desktop"; deviceName: string | null;
  os: string | null; osVersion: string | null; browser: string | null; browserVersion: string | null;
  userAgent: string | null; ip: string | null; location: string | null;
  loginCount: number; firstSeenAt: string; lastSeenAt: string;
  status: "unknown" | "approved" | "rejected" | "revoked";
  revokedAt: string | null; revokedByAdminId: number | null; revokedReason: string | null;
  isSuspicious: boolean; suspiciousReason: string | null;
}

interface DeviceEvent {
  id: number; userId: number; fingerprint: string | null; deviceType: string | null;
  action: string; adminId: number | null; reason: string | null;
  ip: string | null; userAgent: string | null; meta: string | null; createdAt: string;
}

interface DeviceSettings {
  userId?: number; maxDesktopDevices: number; requireMobileBinding: boolean;
  singleMobileSession: boolean; enforcementMode: boolean;
}

interface ActionModal {
  title: string; description: string;
  requireReason: boolean; reasonLabel?: string;
  fn: (reason: string) => void;
}

const EMPTY = { name: "", email: "", username: "", password: "", phone: "", status: "active", language: "fr", roleId: "none", workerId: "none", branchIds: [] as number[], posAccess: false, adminAccess: false };

function statusColor(s: string) {
  const m: Record<string, string> = { active: "bg-green-100 text-green-700", suspended: "bg-red-100 text-red-700", archived: "bg-gray-100 text-gray-500", invited: "bg-blue-100 text-blue-700" };
  return m[s] ?? "bg-gray-100";
}

function deviceStatusBadge(status: string, isSuspicious: boolean) {
  if (isSuspicious) return <Badge className="text-xs bg-orange-100 text-orange-700 border-orange-200 gap-1"><AlertTriangle className="h-3 w-3" />Suspect</Badge>;
  const m: Record<string, React.ReactNode> = {
    unknown: <Badge variant="outline" className="text-xs text-gray-500">Inconnu</Badge>,
    approved: <Badge className="text-xs bg-green-100 text-green-700 border-green-200 gap-1"><CheckCircle className="h-3 w-3" />Approuvé</Badge>,
    rejected: <Badge className="text-xs bg-red-100 text-red-700 border-red-200 gap-1"><XCircle className="h-3 w-3" />Rejeté</Badge>,
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
    login: "Connexion", new_device: "Nouvel appareil", failed_login: "Tentative échouée",
    approved: "Approuvé", rejected: "Rejeté", revoked: "Révoqué",
    reset_mobile: "Reset mobile", reset_desktop: "Reset desktop",
    disconnect_all: "Déconnexion forcée",
  };
  return m[action] ?? action;
}

function actionColor(action: string) {
  if (action === "failed_login") return "bg-red-50 border-l-2 border-red-400";
  if (action === "new_device") return "bg-blue-50 border-l-2 border-blue-400";
  if (action === "approved") return "bg-green-50 border-l-2 border-green-400";
  if (action === "reset_mobile" || action === "reset_desktop" || action === "disconnect_all") return "bg-orange-50 border-l-2 border-orange-400";
  return "hover:bg-muted/30";
}

// ── DeviceCard ────────────────────────────────────────────────────────────────

function DeviceCard({ device, onPatch, disabled }: { device: DeviceRecord; onPatch: (status: string, reason: string) => void; disabled: boolean }) {
  const [showReason, setShowReason] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState("");

  function handleAction(status: string) {
    if (status === "approved") { onPatch(status, ""); return; }
    setShowReason(status); setReasonText("");
  }
  function confirmAction() {
    if (!reasonText.trim()) return;
    onPatch(showReason!, reasonText); setShowReason(null); setReasonText("");
  }

  return (
    <div className={`border rounded-lg p-3 ${device.isSuspicious ? "border-orange-200 bg-orange-50/50" : device.status === "revoked" || device.status === "rejected" ? "opacity-70 bg-gray-50" : "bg-card"}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${device.deviceType === "mobile" ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-600"}`}>
          {device.deviceType === "mobile" ? <Smartphone className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <p className="text-sm font-medium truncate">{device.deviceName ?? "Appareil inconnu"}</p>
            {deviceStatusBadge(device.status, device.isSuspicious)}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {device.ip && <span className="font-mono">IP: {device.ip}</span>}
            {device.location && <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{device.location}</span>}
            <span>{device.loginCount} connexion{device.loginCount !== 1 ? "s" : ""}</span>
            <span>Dernier: {formatDate(device.lastSeenAt)}</span>
            <span>Premier: {formatDate(device.firstSeenAt)}</span>
          </div>
          {device.isSuspicious && device.suspiciousReason && (
            <p className="text-xs text-orange-600 mt-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3 shrink-0" />{device.suspiciousReason}</p>
          )}
          {(device.status === "revoked" || device.status === "rejected") && device.revokedReason && (
            <p className="text-xs text-muted-foreground mt-1">Raison : {device.revokedReason}</p>
          )}
          {showReason && (
            <div className="mt-2 space-y-1.5">
              <Textarea placeholder="Raison obligatoire…" value={reasonText} onChange={e => setReasonText(e.target.value)} className="text-xs h-16 resize-none" />
              <div className="flex gap-2">
                <Button size="sm" className="text-xs h-7 px-3" onClick={confirmAction} disabled={!reasonText.trim()}>Confirmer</Button>
                <Button size="sm" variant="ghost" className="text-xs h-7 px-3" onClick={() => setShowReason(null)}>Annuler</Button>
              </div>
            </div>
          )}
        </div>
        {!showReason && (
          <div className="flex gap-1 shrink-0">
            {device.status !== "approved" && (
              <TooltipProvider><Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600 hover:bg-green-50" disabled={disabled} onClick={() => handleAction("approved")}>
                    <CheckCircle className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger><TooltipContent>Approuver</TooltipContent>
              </Tooltip></TooltipProvider>
            )}
            {device.status !== "rejected" && device.status !== "revoked" && (
              <TooltipProvider><Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:bg-red-50" disabled={disabled} onClick={() => handleAction("rejected")}>
                    <XCircle className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger><TooltipContent>Rejeter</TooltipContent>
              </Tooltip></TooltipProvider>
            )}
            {device.status !== "revoked" && (
              <TooltipProvider><Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-500 hover:bg-gray-100" disabled={disabled} onClick={() => handleAction("revoked")}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger><TooltipContent>Révoquer</TooltipContent>
              </Tooltip></TooltipProvider>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ActionModal component ─────────────────────────────────────────────────────

function ActionModalDialog({ modal, onClose }: { modal: ActionModal; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const canConfirm = !modal.requireReason || reason.trim().length > 0;
  return (
    <AlertDialog open onOpenChange={open => { if (!open) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{modal.title}</AlertDialogTitle>
          <AlertDialogDescription>{modal.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {modal.requireReason && (
          <div className="px-0 pb-2">
            <Label className="text-sm mb-1.5 block">{modal.reasonLabel ?? "Raison *"}</Label>
            <Textarea placeholder="Entrez la raison…" value={reason} onChange={e => setReason(e.target.value)} className="resize-none h-20" />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Annuler</AlertDialogCancel>
          <AlertDialogAction disabled={!canConfirm} onClick={() => { modal.fn(reason); onClose(); }}>Confirmer</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── DeviceDialog ──────────────────────────────────────────────────────────────

function DeviceDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const qc = useQueryClient();
  const token = () => localStorage.getItem("erp_token") ?? "";
  const [actionModal, setActionModal] = useState<ActionModal | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [localSettings, setLocalSettings] = useState<DeviceSettings | null>(null);

  const { data: devices = [], isLoading: devicesLoading } = useQuery<DeviceRecord[]>({
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

  const { data: deviceSettings } = useQuery<DeviceSettings>({
    queryKey: ["user-device-settings", user.id],
    queryFn: async () => {
      const r = await fetch(`/api/users/${user.id}/device-settings`, { headers: { Authorization: `Bearer ${token()}` } });
      return r.ok ? r.json() : { maxDesktopDevices: 3, requireMobileBinding: true, singleMobileSession: false, enforcementMode: false };
    },
  });

  useEffect(() => { if (deviceSettings && !localSettings) setLocalSettings(deviceSettings); }, [deviceSettings]);

  const currentSettings = localSettings ?? deviceSettings ?? { maxDesktopDevices: 3, requireMobileBinding: true, singleMobileSession: false, enforcementMode: false };

  const saveSettings = useMutation({
    mutationFn: async (s: DeviceSettings) => {
      const r = await fetch(`/api/users/${user.id}/device-settings`, {
        method: "PUT", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as any).error ?? "Erreur");
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["user-device-settings", user.id] }); toast({ title: "Paramètres enregistrés" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const patchDevice = useMutation({
    mutationFn: async ({ fingerprint, status, reason }: { fingerprint: string; status: string; reason: string }) => {
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
    mutationFn: async (reason: string) => {
      const r = await fetch(`/api/users/${user.id}/devices/reset-mobile`, {
        method: "POST", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as any).error ?? "Erreur");
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["user-devices", user.id] }); qc.invalidateQueries({ queryKey: ["user-device-events", user.id] }); toast({ title: "Appareils mobiles réinitialisés — session invalidée" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const resetDesktop = useMutation({
    mutationFn: async (reason: string) => {
      const r = await fetch(`/api/users/${user.id}/devices/reset-desktop`, {
        method: "POST", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as any).error ?? "Erreur");
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["user-devices", user.id] }); qc.invalidateQueries({ queryKey: ["user-device-events", user.id] }); toast({ title: "Appareils desktop réinitialisés — session invalidée" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const disconnectAll = useMutation({
    mutationFn: async (reason: string) => {
      const r = await fetch(`/api/users/${user.id}/disconnect-all`, {
        method: "POST", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
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
  const suspiciousDevices = devices.filter(d => d.isSuspicious);
  const failedLogins = events.filter(e => e.action === "failed_login");
  const suspiciousCount = new Set([...suspiciousDevices.map(d => d.fingerprint), ...failedLogins.map(e => e.fingerprint ?? "")]).size;

  const anyPending = patchDevice.isPending || resetMobile.isPending || resetDesktop.isPending || disconnectAll.isPending || saveSettings.isPending;

  return (
    <>
      <Dialog open onOpenChange={() => onClose()}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Appareils et sécurité —{" "}
              <span className="font-normal text-muted-foreground">{user.name}</span>
              {suspiciousCount > 0 && (
                <Badge className="ml-1 text-xs bg-orange-100 text-orange-700 border-orange-200 gap-1">
                  <AlertTriangle className="h-3 w-3" />{suspiciousCount} suspect{suspiciousCount > 1 ? "s" : ""}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="devices" className="mt-1">
            <TabsList>
              <TabsTrigger value="devices">
                Appareils <Badge variant="outline" className="ml-1.5 text-xs">{devices.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="history">
                Historique <Badge variant="outline" className="ml-1.5 text-xs">{events.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="suspicious" className={suspiciousCount > 0 ? "text-orange-600" : ""}>
                Suspects
                {suspiciousCount > 0 && <Badge className="ml-1.5 text-xs bg-orange-100 text-orange-700 border-orange-200">{suspiciousCount}</Badge>}
              </TabsTrigger>
            </TabsList>

            {/* ── Appareils tab ──────────────────────────────────────────────────── */}
            <TabsContent value="devices" className="space-y-3 mt-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" disabled={anyPending || mobiles.length === 0}
                  onClick={() => setActionModal({ title: "Reset mobile", description: "Tous les appareils mobiles seront révoqués et l'utilisateur sera déconnecté.", requireReason: true, reasonLabel: "Raison du reset *", fn: (r) => resetMobile.mutate(r) })}>
                  <Smartphone className="h-3.5 w-3.5" />Reset mobiles
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" disabled={anyPending || desktops.length === 0}
                  onClick={() => setActionModal({ title: "Reset desktop", description: "Tous les appareils desktop seront révoqués et l'utilisateur sera déconnecté.", requireReason: true, reasonLabel: "Raison du reset *", fn: (r) => resetDesktop.mutate(r) })}>
                  <Monitor className="h-3.5 w-3.5" />Reset desktops
                </Button>
                <div className="flex-1" />
                <Button size="sm" variant="destructive" className="gap-1.5 text-xs" disabled={anyPending}
                  onClick={() => setActionModal({ title: "Déconnecter toutes les sessions", description: "L'utilisateur sera immédiatement déconnecté de tous ses appareils.", requireReason: false, fn: (r) => disconnectAll.mutate(r) })}>
                  <LogOut className="h-3.5 w-3.5" />Déconnecter tout
                </Button>
              </div>

              {devicesLoading ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Chargement…</p>
              ) : devices.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground">
                  <Shield className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Aucun appareil enregistré</p>
                  <p className="text-xs mt-1">Les appareils apparaissent automatiquement à la première connexion</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {mobiles.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <Smartphone className="h-3.5 w-3.5" />Mobiles ({mobiles.length}/{currentSettings.maxDesktopDevices === 1 ? "1" : "1 max"})
                      </p>
                      <div className="space-y-2">
                        {mobiles.map(d => <DeviceCard key={d.fingerprint} device={d} onPatch={(status, reason) => patchDevice.mutate({ fingerprint: d.fingerprint, status, reason })} disabled={anyPending} />)}
                      </div>
                    </div>
                  )}
                  {desktops.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <Monitor className="h-3.5 w-3.5" />Desktops ({desktops.length}/{currentSettings.maxDesktopDevices} max)
                      </p>
                      <div className="space-y-2">
                        {desktops.map(d => <DeviceCard key={d.fingerprint} device={d} onPatch={(status, reason) => patchDevice.mutate({ fingerprint: d.fingerprint, status, reason })} disabled={anyPending} />)}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Settings collapsible ─────────────────────────────────── */}
              <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between text-xs text-muted-foreground mt-2">
                    Paramètres de sécurité
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${settingsOpen ? "rotate-180" : ""}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <Card className="mt-2">
                    <CardContent className="pt-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">Mode d'application</p>
                          <p className="text-xs text-muted-foreground">Bloque les appareils rejetés/révoqués à la connexion</p>
                        </div>
                        <Switch checked={currentSettings.enforcementMode} onCheckedChange={v => setLocalSettings(s => ({ ...(s ?? currentSettings), enforcementMode: v }))} />
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">Liaison mobile obligatoire</p>
                          <p className="text-xs text-muted-foreground">Un seul mobile approuvé à la fois</p>
                        </div>
                        <Switch checked={currentSettings.requireMobileBinding} onCheckedChange={v => setLocalSettings(s => ({ ...(s ?? currentSettings), requireMobileBinding: v }))} />
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">Session mobile unique</p>
                          <p className="text-xs text-muted-foreground">Déconnecte les autres sessions mobiles actives</p>
                        </div>
                        <Switch checked={currentSettings.singleMobileSession} onCheckedChange={v => setLocalSettings(s => ({ ...(s ?? currentSettings), singleMobileSession: v }))} />
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">Desktops max</p>
                          <p className="text-xs text-muted-foreground">Nombre de desktops autorisés</p>
                        </div>
                        <Input type="number" min={1} max={10} className="w-20 h-8 text-sm text-center"
                          value={currentSettings.maxDesktopDevices}
                          onChange={e => setLocalSettings(s => ({ ...(s ?? currentSettings), maxDesktopDevices: parseInt(e.target.value) || 3 }))} />
                      </div>
                      <Button size="sm" className="w-full gap-2" disabled={saveSettings.isPending}
                        onClick={() => saveSettings.mutate(currentSettings)}>
                        <Save className="h-3.5 w-3.5" />Enregistrer les paramètres
                      </Button>
                    </CardContent>
                  </Card>
                </CollapsibleContent>
              </Collapsible>
            </TabsContent>

            {/* ── Historique tab ─────────────────────────────────────────────────── */}
            <TabsContent value="history" className="mt-3">
              {eventsLoading ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Chargement…</p>
              ) : events.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground">
                  <Clock className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Aucun événement enregistré</p>
                </div>
              ) : (
                <div className="space-y-1 max-h-[380px] overflow-y-auto pr-1">
                  {events.map(ev => (
                    <div key={ev.id} className={`flex items-start gap-3 py-2 px-3 rounded-md text-sm ${actionColor(ev.action)}`}>
                      <div className="mt-0.5 shrink-0 text-muted-foreground">
                        {ev.deviceType === "mobile" ? <Smartphone className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{actionLabel(ev.action)}</p>
                        {ev.reason && <p className="text-xs text-muted-foreground">{ev.reason}</p>}
                        {ev.meta && ev.action !== "disconnect_all" && ev.action !== "reset_mobile" && ev.action !== "reset_desktop" && (
                          <p className="text-xs text-orange-600">{ev.meta}</p>
                        )}
                        {ev.ip && <p className="text-xs text-muted-foreground font-mono">IP: {ev.ip}</p>}
                        {ev.fingerprint && <p className="text-xs text-muted-foreground font-mono">ID: {ev.fingerprint.slice(0, 10)}…</p>}
                      </div>
                      <p className="text-xs text-muted-foreground shrink-0 mt-0.5">{formatDate(ev.createdAt)}</p>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ── Tentatives suspectes tab ───────────────────────────────────────── */}
            <TabsContent value="suspicious" className="mt-3 space-y-4">
              {devicesLoading || eventsLoading ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Chargement…</p>
              ) : suspiciousDevices.length === 0 && failedLogins.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground">
                  <CheckCircle className="h-8 w-8 mx-auto mb-2 opacity-30 text-green-500" />
                  <p className="text-sm">Aucune activité suspecte détectée</p>
                </div>
              ) : (
                <>
                  {suspiciousDevices.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-orange-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5" />Appareils suspects ({suspiciousDevices.length})
                      </p>
                      <div className="space-y-2">
                        {suspiciousDevices.map(d => <DeviceCard key={d.fingerprint} device={d} onPatch={(status, reason) => patchDevice.mutate({ fingerprint: d.fingerprint, status, reason })} disabled={anyPending} />)}
                      </div>
                    </div>
                  )}
                  {failedLogins.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-red-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <XCircle className="h-3.5 w-3.5" />Connexions échouées ({failedLogins.length})
                      </p>
                      <div className="space-y-1 max-h-[280px] overflow-y-auto pr-1">
                        {failedLogins.map(ev => (
                          <div key={ev.id} className="flex items-start gap-3 py-2 px-3 rounded-md text-sm bg-red-50 border-l-2 border-red-400">
                            <div className="mt-0.5 shrink-0">
                              {ev.deviceType === "mobile" ? <Smartphone className="h-3.5 w-3.5 text-red-500" /> : <Monitor className="h-3.5 w-3.5 text-red-500" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-red-700">Tentative bloquée</p>
                              {ev.meta && <p className="text-xs text-red-600">{ev.meta}</p>}
                              {ev.ip && <p className="text-xs text-muted-foreground font-mono">IP: {ev.ip}</p>}
                              {ev.fingerprint && <p className="text-xs text-muted-foreground font-mono">ID: {ev.fingerprint.slice(0, 10)}…</p>}
                            </div>
                            <p className="text-xs text-muted-foreground shrink-0 mt-0.5">{formatDate(ev.createdAt)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={onClose}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {actionModal && <ActionModalDialog modal={actionModal} onClose={() => setActionModal(null)} />}
    </>
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
                  <TableHead className="w-24"></TableHead>
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
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                          disabled={(authUser as any)?.id === u.id} onClick={() => setDeleteTarget(u)}>
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
                      <SelectItem value="active">Actif</SelectItem><SelectItem value="suspended">Suspendu</SelectItem>
                      <SelectItem value="invited">Invité</SelectItem><SelectItem value="archived">Archivé</SelectItem>
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
                      <Checkbox checked={form.branchIds.includes(b.id)} onCheckedChange={() => toggleBranch(b.id)} />{b.name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={form.adminAccess} onCheckedChange={v => setForm(f => ({ ...f, adminAccess: !!v }))} />Accès administrateur
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={form.posAccess} onCheckedChange={v => setForm(f => ({ ...f, posAccess: !!v }))} />Accès caisse (POS)
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
                Êtes-vous sûr de vouloir supprimer <strong>{deleteTarget?.name ?? deleteTarget?.username}</strong> ? Cette action est irréversible.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction className="bg-red-600 hover:bg-red-700"
                onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
                disabled={deleteMutation.isPending}>Supprimer</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {deviceTarget && <DeviceDialog user={deviceTarget} onClose={() => setDeviceTarget(null)} />}
    </>
  );
}
