import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Bell, Plus, Eye, Send, RefreshCw, Archive, Users, CheckCheck,
  AlertTriangle, AlertCircle, Megaphone, ClipboardList, Loader2, X,
  UserCheck, Search,
} from "lucide-react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");
function authHeader() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` };
}

const NOTIF_TYPES = [
  { value: "normal",             label: "Notification" },
  { value: "important",          label: "Alerte importante" },
  { value: "warning",            label: "Avertissement" },
  { value: "work_instructions",  label: "Instructions de travail" },
  { value: "admin_announcement", label: "Annonce admin" },
];

const PRIORITIES = [
  { value: "normal",    label: "Normal" },
  { value: "important", label: "Important" },
  { value: "urgent",    label: "Urgent" },
];

const PRIORITY_COLORS: Record<string, string> = {
  normal:    "bg-slate-100 text-slate-700",
  important: "bg-blue-100 text-blue-700",
  urgent:    "bg-red-100 text-red-700",
};

const TYPE_LABELS: Record<string, string> = {
  normal:             "Notification",
  important:          "Important",
  warning:            "Avertissement",
  work_instructions:  "Instructions",
  admin_announcement: "Annonce",
};

function PriorityBadge({ p }: { p: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_COLORS[p] ?? PRIORITY_COLORS.normal}`}>
      {PRIORITIES.find(x => x.value === p)?.label ?? p}
    </span>
  );
}

function TypeBadge({ t }: { t: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
      {TYPE_LABELS[t] ?? t}
    </span>
  );
}

const EMPTY_FORM = {
  title: "", body: "", type: "normal", priority: "normal",
  recipientMode: "all" as "all" | "specific",
  selectedUserIds: [] as number[],
};

export default function WorkerNotificationsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const _perms: string[] = (user as any)?.permissions ?? [];
  function _hasPerm(p: string) {
    if (_perms.includes("*")) return true;
    if (_perms.includes(p)) return true;
    const mod = p.split(".")[0];
    return _perms.includes(`${mod}.*`);
  }
  const canCreate = user?.adminAccess || _hasPerm("worker_notif.create");
  const canEdit   = user?.adminAccess || _hasPerm("worker_notif.edit");
  const canDelete = user?.adminAccess || _hasPerm("worker_notif.delete");

  const [createOpen, setCreateOpen]   = useState(false);
  const [detailId, setDetailId]       = useState<number | null>(null);
  const [form, setForm]               = useState(EMPTY_FORM);
  const [workerSearch, setWorkerSearch] = useState("");

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

  const { data: recipients = [] } = useQuery<any[]>({
    queryKey: ["notif-recipients"],
    queryFn: async () => {
      const r = await fetch(`${API}/api/worker-notifications/recipients`, { headers: authHeader() });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: createOpen,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const criteria = form.recipientMode === "all"
        ? { mode: "all_users" }
        : { mode: "specific", userIds: form.selectedUserIds };

      const r = await fetch(`${API}/api/worker-notifications`, {
        method: "POST",
        headers: authHeader(),
        body: JSON.stringify({
          title: form.title,
          body:  form.body,
          type:  form.type,
          priority: form.priority,
          criteria,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Erreur");
      return d;
    },
    onSuccess: (d) => {
      const pushNote = d.pushOk > 0 ? ` · ${d.pushOk} push envoyé(s)` : "";
      toast({ title: "Notification envoyée", description: `${d.totalRecipients} destinataire(s)${pushNote}` });
      qc.invalidateQueries({ queryKey: ["worker-notifications"] });
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      setWorkerSearch("");
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

  function handleSend() {
    if (!form.title.trim() || !form.body.trim()) {
      toast({ title: "Remplissez le titre et le contenu", variant: "destructive" });
      return;
    }
    if (form.recipientMode === "specific" && form.selectedUserIds.length === 0) {
      toast({ title: "Sélectionnez au moins un destinataire", variant: "destructive" });
      return;
    }
    createMutation.mutate();
  }

  function toggleUser(id: number) {
    setForm(f => ({
      ...f,
      selectedUserIds: f.selectedUserIds.includes(id)
        ? f.selectedUserIds.filter(x => x !== id)
        : [...f.selectedUserIds, id],
    }));
  }

  const q = workerSearch.trim().toLowerCase();
  const filteredRecipients = recipients.filter((u: any) =>
    !q ||
    u.name?.toLowerCase().includes(q) ||
    u.username?.toLowerCase().includes(q) ||
    u.roleName?.toLowerCase().includes(q) ||
    u.workerName?.toLowerCase().includes(q)
  );
  const selectedRecipients = recipients.filter((u: any) => form.selectedUserIds.includes(u.id));

  if (!user?.adminAccess) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">Accès non autorisé</div>;
  }

  const notifications = data?.notifications ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-xl font-bold">Notifications employés</h1>
            <p className="text-xs text-muted-foreground">Envoyer des messages à votre équipe</p>
          </div>
        </div>
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            Nouveau
          </Button>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>
      ) : notifications.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-14 gap-3">
            <Bell className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Aucune notification envoyée</p>
            {canCreate && <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>Envoyer la première</Button>}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map((n: any) => {
            const readPct = n.total_recipients > 0 ? Math.round((n.read_count / n.total_recipients) * 100) : 0;
            return (
              <Card key={n.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                        <PriorityBadge p={n.priority} />
                        <TypeBadge t={n.type} />
                        <span className="text-xs text-muted-foreground">{new Date(n.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      <p className="font-semibold text-sm">{n.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{n.body}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Users className="h-3 w-3" />{n.total_recipients}</span>
                        <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{n.read_count} lu</span>
                        <span className="flex items-center gap-1"><CheckCheck className="h-3 w-3" />{n.ack_count} accusé</span>
                        <span className="text-primary font-medium">{readPct}%</span>
                        {n.push_failed_count > 0 && <span className="text-amber-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{n.push_failed_count}</span>}
                      </div>
                      <div className="mt-1.5 h-1 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${readPct}%` }} />
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDetailId(n.id)}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      {canCreate && n.push_failed_count > 0 && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => resendMutation.mutate(n.id)}>
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {canDelete && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => {
                          if (confirm("Archiver cette notification ?")) archiveMutation.mutate(n.id);
                        }}>
                          <Archive className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Create Dialog ── */}
      <Dialog open={createOpen} onOpenChange={open => { setCreateOpen(open); if (!open) { setForm(EMPTY_FORM); setWorkerSearch(""); } }}>
        <DialogContent className="w-full max-w-md max-h-[92vh] overflow-y-auto p-0">
          <DialogHeader className="px-4 pt-5 pb-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Send className="h-4 w-4" />
              Envoyer une notification
            </DialogTitle>
          </DialogHeader>

          <div className="px-4 py-4 space-y-4">
            {/* Title */}
            <div>
              <Label className="text-xs font-medium mb-1.5 block">Titre *</Label>
              <Input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Titre du message..."
                className="text-sm"
              />
            </div>

            {/* Body */}
            <div>
              <Label className="text-xs font-medium mb-1.5 block">Message *</Label>
              <Textarea
                value={form.body}
                onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                rows={3}
                placeholder="Contenu du message..."
                className="text-sm resize-none"
              />
            </div>

            {/* Type + Priority */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Type</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger className="text-xs h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {NOTIF_TYPES.map(t => <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-medium mb-1.5 block">Priorité</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger className="text-xs h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map(p => <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.priority !== "normal" && (
              <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-2">
                Les priorités <strong>Important</strong> et <strong>Urgent</strong> affichent un accusé de réception à la connexion de l'employé.
              </p>
            )}

            {/* Recipients */}
            <div>
              <Label className="text-xs font-medium mb-2 block flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                Destinataires
              </Label>

              {/* Mode toggle */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                {(["all", "specific"] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, recipientMode: mode, selectedUserIds: [] }))}
                    className={`py-2 px-3 rounded-lg border text-xs font-medium transition-all ${
                      form.recipientMode === mode
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40"
                    }`}
                  >
                    {mode === "all" ? "Tous les utilisateurs" : "Utilisateurs spécifiques"}
                  </button>
                ))}
              </div>

              {/* Specific worker picker */}
              {form.recipientMode === "specific" && (
                <div className="space-y-2">
                  {/* Selected chips */}
                  {selectedRecipients.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedRecipients.map((u: any) => (
                        <span key={u.id} className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-1 rounded-full">
                          <UserCheck className="h-3 w-3" />
                          {u.name}
                          <button onClick={() => toggleUser(u.id)} className="ml-0.5 hover:text-destructive">
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Search + list */}
                  <div className="border rounded-lg overflow-hidden">
                    <div className="flex items-center gap-2 px-2.5 py-1.5 border-b bg-muted/30">
                      <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <input
                        type="text"
                        placeholder="Rechercher par nom, identifiant ou rôle..."
                        value={workerSearch}
                        onChange={e => setWorkerSearch(e.target.value)}
                        className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                      />
                    </div>
                    <div className="max-h-44 overflow-y-auto divide-y">
                      {filteredRecipients.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-4">Aucun utilisateur trouvé</p>
                      ) : filteredRecipients.map((u: any) => {
                        const checked = form.selectedUserIds.includes(u.id);
                        const inactive = u.active === false;
                        return (
                          <button
                            key={u.id}
                            type="button"
                            disabled={inactive}
                            onClick={() => toggleUser(u.id)}
                            className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors ${
                              inactive ? "opacity-50 cursor-not-allowed" : checked ? "bg-primary/5" : "hover:bg-muted/50"
                            }`}
                          >
                            <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${
                              checked ? "bg-primary border-primary" : "border-input"
                            }`}>
                              {checked && <CheckCheck className="h-2.5 w-2.5 text-white" />}
                            </div>
                            <div className="min-w-0">
                              <span className="font-medium block truncate">{u.name}</span>
                              {u.workerName && u.workerName !== u.name && (
                                <span className="text-[10px] text-muted-foreground block truncate">Ouvrier : {u.workerName}</span>
                              )}
                            </div>
                            {inactive ? (
                              <span className="text-[10px] font-medium ml-auto px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 shrink-0">
                                Compte inactif
                              </span>
                            ) : (
                              u.roleName && <span className="text-xs text-muted-foreground ml-auto shrink-0">{u.roleName}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {recipients.length > 0 && (
                      <div className="flex justify-between items-center px-3 py-1.5 bg-muted/20 border-t text-xs text-muted-foreground">
                        <button className="text-primary hover:underline" onClick={() => setForm(f => ({ ...f, selectedUserIds: recipients.filter((u: any) => u.active !== false).map((u: any) => u.id) }))}>
                          Tout sélectionner
                        </button>
                        <span>{form.selectedUserIds.length} sélectionné(s)</span>
                        <button className="hover:underline" onClick={() => setForm(f => ({ ...f, selectedUserIds: [] }))}>
                          Effacer
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-4 pb-5 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setCreateOpen(false)}>
              Annuler
            </Button>
            <Button className="flex-1 gap-2" onClick={handleSend} disabled={createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Envoyer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Detail Dialog ── */}
      <Dialog open={!!detailId} onOpenChange={o => { if (!o) setDetailId(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">Détails de la notification</DialogTitle>
          </DialogHeader>
          {detail ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <PriorityBadge p={detail.notification.priority} />
                <TypeBadge t={detail.notification.type} />
              </div>
              <div>
                <p className="font-bold">{detail.notification.title}</p>
                <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{detail.notification.body}</p>
                <p className="text-xs text-muted-foreground mt-1">Par {detail.notification.sender_name} — {new Date(detail.notification.created_at).toLocaleString("fr-FR")}</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Destinataires", value: detail.notification.total_recipients, color: "text-primary" },
                  { label: "Lu",            value: detail.notification.read_count,      color: "text-green-600" },
                  { label: "Non lu",        value: detail.notification.unread_count,    color: "text-red-500" },
                  { label: "Accusé",        value: detail.notification.ack_count,       color: "text-blue-600" },
                ].map(s => (
                  <div key={s.label} className="border rounded-lg p-3 text-center">
                    <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>

              <div className="border rounded-lg overflow-hidden">
                <div className="bg-muted/40 px-3 py-2 text-xs font-semibold flex items-center justify-between">
                  <span>Destinataires</span>
                  {detail.notification.push_failed_count > 0 && (
                    <Button size="sm" variant="outline" className="h-6 text-xs gap-1" onClick={() => resendMutation.mutate(detailId!)} disabled={resendMutation.isPending}>
                      {resendMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      Renvoyer push
                    </Button>
                  )}
                </div>
                <div className="divide-y max-h-52 overflow-y-auto">
                  {detail.recipients.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between px-3 py-2 text-xs hover:bg-muted/20">
                      <div>
                        <span className="font-medium">{r.user_name}</span>
                        {r.worker_name && r.worker_name !== r.user_name && (
                          <span className="text-muted-foreground ml-1">({r.worker_name})</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        {r.push_failed ? (
                          <span className="text-amber-600 flex items-center gap-0.5"><AlertTriangle className="h-3 w-3" />Push échoué</span>
                        ) : r.push_sent_at ? (
                          <span className="text-green-600 flex items-center gap-0.5"><CheckCheck className="h-3 w-3" />Push</span>
                        ) : null}
                        {r.read_at
                          ? <span className="text-green-700">Lu</span>
                          : <span className="text-red-400">Non lu</span>}
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
