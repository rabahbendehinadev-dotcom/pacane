import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Bell, Plus, Eye, Send, RefreshCw, Archive, Users, CheckCheck,
  AlertTriangle, AlertCircle, Info, Megaphone, ClipboardList, Loader2,
  ChevronDown, ChevronUp, UserCheck
} from "lucide-react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");
function authHeader() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` };
}

const NOTIF_TYPES = [
  { value: "normal", label: "Notification", icon: Bell },
  { value: "important", label: "Alerte importante", icon: AlertCircle },
  { value: "warning", label: "Avertissement", icon: AlertTriangle },
  { value: "work_instructions", label: "Instructions de travail", icon: ClipboardList },
  { value: "admin_announcement", label: "Annonce admin", icon: Megaphone },
];

const PRIORITIES = [
  { value: "normal", label: "Normal", color: "bg-slate-100 text-slate-700" },
  { value: "important", label: "Important", color: "bg-blue-100 text-blue-700" },
  { value: "urgent", label: "Urgent", color: "bg-red-100 text-red-700" },
];

const RECIPIENT_MODES = [
  { value: "all_workers", label: "Tous les employés" },
  { value: "all_users", label: "Tous les utilisateurs" },
  { value: "specific", label: "Employés spécifiques" },
  { value: "branch", label: "Par boutique" },
  { value: "worker_status", label: "Par statut d'employé" },
  { value: "role", label: "Par rôle" },
];

function priorityBadge(p: string) {
  const map: Record<string, string> = {
    normal: "bg-slate-100 text-slate-700",
    important: "bg-blue-100 text-blue-700",
    urgent: "bg-red-100 text-red-700",
  };
  const labels: Record<string, string> = { normal: "Normal", important: "Important", urgent: "Urgent" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[p] ?? map.normal}`}>{labels[p] ?? p}</span>;
}

function typeBadge(t: string) {
  const labels: Record<string, string> = {
    normal: "Notification", important: "Important", warning: "Avertissement",
    work_instructions: "Instructions", admin_announcement: "Annonce",
  };
  return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">{labels[t] ?? t}</span>;
}

export default function WorkerNotificationsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [previewData, setPreviewData] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [form, setForm] = useState({
    title: "", body: "", type: "normal", priority: "normal",
    expiresAt: "", imageUrl: "",
    criteria: { mode: "all_workers", workerIds: [] as number[], branchId: "", workerStatus: "active", roleId: "" },
  });
  const [workerSearch, setWorkerSearch] = useState("");
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<number[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["worker-notifications"],
    queryFn: async () => {
      const r = await fetch(`${API}/api/worker-notifications`, { headers: authHeader() });
      if (!r.ok) throw new Error("Erreur");
      return r.json();
    },
  });

  const { data: detail } = useQuery({
    queryKey: ["worker-notification-detail", detailId],
    queryFn: async () => {
      const r = await fetch(`${API}/api/worker-notifications/${detailId}`, { headers: authHeader() });
      if (!r.ok) throw new Error("Erreur");
      return r.json();
    },
    enabled: !!detailId,
  });

  const { data: workers } = useQuery({
    queryKey: ["workers-list-for-notif"],
    queryFn: async () => {
      const r = await fetch(`${API}/api/workers`, { headers: authHeader() });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: form.criteria.mode === "specific",
  });

  const { data: branches } = useQuery({
    queryKey: ["branches-for-notif"],
    queryFn: async () => {
      const r = await fetch(`${API}/api/branches`, { headers: authHeader() });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: form.criteria.mode === "branch",
  });

  const { data: roles } = useQuery({
    queryKey: ["roles-for-notif"],
    queryFn: async () => {
      const r = await fetch(`${API}/api/roles`, { headers: authHeader() });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: form.criteria.mode === "role",
  });

  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      const r = await fetch(`${API}/api/worker-notifications`, {
        method: "POST", headers: authHeader(), body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Erreur");
      return d;
    },
    onSuccess: (d) => {
      toast({ title: "Envoyé", description: `Notification envoyée à ${d.totalRecipients} destinataire(s)` });
      qc.invalidateQueries({ queryKey: ["worker-notifications"] });
      setCreateOpen(false);
      setPreviewData(null);
      setForm({ title: "", body: "", type: "normal", priority: "normal", expiresAt: "", imageUrl: "", criteria: { mode: "all_workers", workerIds: [], branchId: "", workerStatus: "active", roleId: "" } });
      setSelectedWorkerIds([]);
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`${API}/api/worker-notifications/${id}`, { method: "DELETE", headers: authHeader() });
    },
    onSuccess: () => { toast({ title: "Archivé" }); qc.invalidateQueries({ queryKey: ["worker-notifications"] }); },
  });

  const resendMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${API}/api/worker-notifications/${id}/resend`, { method: "POST", headers: authHeader() });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Erreur");
      return d;
    },
    onSuccess: (d) => { toast({ title: "Renvoyé", description: `${d.resent} / ${d.total}` }); qc.invalidateQueries({ queryKey: ["worker-notification-detail", detailId] }); },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  async function previewRecipients() {
    setPreviewLoading(true);
    try {
      const criteria = buildCriteria();
      const r = await fetch(`${API}/api/worker-notifications/recipient-preview`, {
        method: "POST", headers: authHeader(), body: JSON.stringify({ criteria }),
      });
      const d = await r.json();
      setPreviewData(d);
    } catch { /* ignore */ }
    setPreviewLoading(false);
  }

  function buildCriteria() {
    const c = { ...form.criteria };
    if (c.mode === "specific") {
      (c as any).workerIds = selectedWorkerIds;
    }
    return c;
  }

  function handleSend() {
    if (!form.title.trim() || !form.body.trim()) {
      toast({ title: "Veuillez remplir le titre et le contenu", variant: "destructive" });
      return;
    }
    createMutation.mutate({ ...form, criteria: buildCriteria() });
  }

  const filteredWorkers = (workers || []).filter((w: any) =>
    w.name?.toLowerCase().includes(workerSearch.toLowerCase())
  );

  if (!user?.adminAccess) {
    return <DashboardLayout><div className="flex items-center justify-center h-64 text-muted-foreground">Accès non autorisé</div></DashboardLayout>;
  }

  const notifications = data?.notifications ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Notifications employés</h1>
            <p className="text-sm text-muted-foreground">Envoyer et suivre les notifications aux employés</p>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Nouvelle notification
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : notifications.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
            <Bell className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">Aucune notification pour l'instant</p>
            <Button onClick={() => setCreateOpen(true)} variant="outline">Créer la première notification</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {notifications.map((n: any) => {
            const readPct = n.total_recipients > 0 ? Math.round((n.read_count / n.total_recipients) * 100) : 0;
            return (
              <Card key={n.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        {priorityBadge(n.priority)}
                        {typeBadge(n.type)}
                        <span className="text-xs text-muted-foreground">{new Date(n.created_at).toLocaleString("fr-FR")}</span>
                      </div>
                      <h3 className="font-semibold text-sm">{n.title}</h3>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.body}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Users className="h-3 w-3" />{n.total_recipients} destinataire{n.total_recipients > 1 ? "s" : ""}</span>
                        <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{n.read_count} lu</span>
                        <span className="flex items-center gap-1"><CheckCheck className="h-3 w-3" />{n.ack_count} accusé</span>
                        <span className="text-primary font-medium">{readPct}% lu</span>
                        {n.push_failed_count > 0 && (
                          <span className="text-amber-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{n.push_failed_count} échec push</span>
                        )}
                      </div>
                      <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${readPct}%` }} />
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => setDetailId(n.id)}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      {n.push_failed_count > 0 && (
                        <Button size="sm" variant="outline" onClick={() => { setDetailId(n.id); resendMutation.mutate(n.id); }}>
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => {
                        if (confirm("Archiver cette notification ?")) archiveMutation.mutate(n.id);
                      }}>
                        <Archive className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Send className="h-5 w-5" />Envoyer une notification aux employés</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="mb-1.5 block">Titre de la notification *</Label>
              <Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Titre de la notification..." />
            </div>
            <div>
              <Label className="mb-1.5 block">Contenu du message *</Label>
              <Textarea value={form.body} onChange={e => setForm(p => ({ ...p, body: e.target.value }))} rows={4} placeholder="Écrivez le message ici..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block">Type de notification</Label>
                <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {NOTIF_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block">Priorité</Label>
                <Select value={form.priority} onValueChange={v => setForm(p => ({ ...p, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="mb-1.5 block">Date d'expiration (facultatif)</Label>
              <Input type="datetime-local" value={form.expiresAt} onChange={e => setForm(p => ({ ...p, expiresAt: e.target.value }))} />
            </div>

            {/* Recipients */}
            <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
              <Label className="text-sm font-medium flex items-center gap-2"><Users className="h-4 w-4" />Destinataires</Label>
              <div>
                <Select value={form.criteria.mode} onValueChange={v => setForm(p => ({ ...p, criteria: { ...p.criteria, mode: v } }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RECIPIENT_MODES.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {form.criteria.mode === "specific" && (
                <div>
                  <Input placeholder="Rechercher un employé..." value={workerSearch} onChange={e => setWorkerSearch(e.target.value)} className="mb-2" />
                  <div className="max-h-40 overflow-y-auto border rounded space-y-1 p-2 bg-background">
                    {filteredWorkers.map((w: any) => (
                      <label key={w.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted p-1 rounded text-sm">
                        <input
                          type="checkbox"
                          checked={selectedWorkerIds.includes(w.id)}
                          onChange={e => {
                            setSelectedWorkerIds(prev =>
                              e.target.checked ? [...prev, w.id] : prev.filter(id => id !== w.id)
                            );
                          }}
                        />
                        {w.name}
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-1">
                    <button className="text-xs text-primary underline" onClick={() => setSelectedWorkerIds((filteredWorkers || []).map((w: any) => w.id))}>Tout sélectionner</button>
                    <button className="text-xs text-muted-foreground underline" onClick={() => setSelectedWorkerIds([])}>Tout désélectionner</button>
                    <span className="text-xs text-muted-foreground ml-auto">{selectedWorkerIds.length} sélectionné(s)</span>
                  </div>
                </div>
              )}
              {form.criteria.mode === "branch" && (
                <Select value={form.criteria.branchId} onValueChange={v => setForm(p => ({ ...p, criteria: { ...p.criteria, branchId: v } }))}>
                  <SelectTrigger><SelectValue placeholder="Choisir une boutique" /></SelectTrigger>
                  <SelectContent>
                    {(branches || []).map((b: any) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {form.criteria.mode === "worker_status" && (
                <Select value={form.criteria.workerStatus} onValueChange={v => setForm(p => ({ ...p, criteria: { ...p.criteria, workerStatus: v } }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Actif</SelectItem>
                    <SelectItem value="inactive">Inactif</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {form.criteria.mode === "role" && (
                <Select value={form.criteria.roleId} onValueChange={v => setForm(p => ({ ...p, criteria: { ...p.criteria, roleId: v } }))}>
                  <SelectTrigger><SelectValue placeholder="Choisir un rôle" /></SelectTrigger>
                  <SelectContent>
                    {(roles || []).map((r: any) => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}

              {/* Preview recipients */}
              <div className="flex items-center gap-2 flex-wrap">
                <Button type="button" size="sm" variant="outline" onClick={previewRecipients} disabled={previewLoading}>
                  {previewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />}
                  Aperçu des destinataires
                </Button>
                {previewData && (
                  <div className="text-xs space-x-3 text-muted-foreground">
                    <span className="text-foreground font-medium">{previewData.total} au total</span>
                    <span className="text-green-600">{previewData.pushEnabled} avec push</span>
                    {previewData.noPush > 0 && <span className="text-amber-600">{previewData.noPush} sans push</span>}
                  </div>
                )}
              </div>
              {previewData?.noPush > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-800">
                  <strong>Attention :</strong> certains destinataires n'ont pas activé les notifications push, mais le message restera visible dans leur compte.
                  {previewData.noPushNames?.length > 0 && (
                    <div className="mt-1 text-amber-700">{previewData.noPushNames.slice(0, 5).join(", ")}{previewData.noPushNames.length > 5 ? ` +${previewData.noPushNames.length - 5}` : ""}</div>
                  )}
                </div>
              )}
            </div>

            {form.priority !== "normal" && (
              <div className="bg-blue-50 border border-blue-200 rounded p-2 text-xs text-blue-800">
                <strong>Note :</strong> les notifications "Important" et "Urgent" affichent une fenêtre d'accusé de réception obligatoire à la connexion de l'employé.
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Annuler</Button>
            <Button onClick={handleSend} disabled={createMutation.isPending} className="flex items-center gap-2">
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Envoyer la notification
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!detailId} onOpenChange={o => { if (!o) setDetailId(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Détails de la notification</DialogTitle>
          </DialogHeader>
          {detail ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                {priorityBadge(detail.notification.priority)}
                {typeBadge(detail.notification.type)}
              </div>
              <h3 className="font-bold text-lg">{detail.notification.title}</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{detail.notification.body}</p>
              <div className="text-xs text-muted-foreground">Par : {detail.notification.sender_name} — {new Date(detail.notification.created_at).toLocaleString("fr-FR")}</div>

              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Destinataires", value: detail.notification.total_recipients, color: "text-primary" },
                  { label: "Lu", value: detail.notification.read_count, color: "text-green-600" },
                  { label: "Non lu", value: detail.notification.unread_count, color: "text-red-500" },
                  { label: "Accusé", value: detail.notification.ack_count, color: "text-blue-600" },
                ].map(s => (
                  <Card key={s.label} className="text-center p-3">
                    <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                    <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
                  </Card>
                ))}
              </div>

              {/* Recipients table */}
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-muted/50 px-3 py-2 text-xs font-semibold flex items-center justify-between">
                  <span>Liste des destinataires</span>
                  {detail.notification.push_failed_count > 0 && (
                    <Button size="sm" variant="outline" onClick={() => resendMutation.mutate(detailId!)} disabled={resendMutation.isPending}>
                      {resendMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      Renvoyer les échecs
                    </Button>
                  )}
                </div>
                <div className="divide-y max-h-64 overflow-y-auto">
                  {detail.recipients.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between px-3 py-2 text-xs hover:bg-muted/30">
                      <div>
                        <div className="font-medium">{r.user_name}</div>
                        {r.worker_name && <div className="text-muted-foreground">{r.worker_name}</div>}
                      </div>
                      <div className="flex items-center gap-3 text-muted-foreground">
                        {r.push_failed ? (
                          <span className="text-amber-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Push échoué</span>
                        ) : r.push_sent_at ? (
                          <span className="text-green-600 flex items-center gap-1"><CheckCheck className="h-3 w-3" />Envoyé</span>
                        ) : <span>Non envoyé</span>}
                        {r.read_at ? <span className="text-green-700">Lu {new Date(r.read_at).toLocaleTimeString("fr-FR")}</span> : <span className="text-red-500">Non lu</span>}
                        {r.acknowledged_at && <span className="text-blue-600">Accusé</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
