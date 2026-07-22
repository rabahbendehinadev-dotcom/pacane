import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, Send, Loader2, Filter, Users, CheckCircle2, Clock, XCircle, MessageSquare, Eye } from "lucide-react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");
function authHeader() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` };
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  new: { label: "Nouveau", color: "bg-blue-100 text-blue-700" },
  reviewing: { label: "En révision", color: "bg-amber-100 text-amber-700" },
  processing: { label: "En traitement", color: "bg-purple-100 text-purple-700" },
  resolved: { label: "Résolu", color: "bg-green-100 text-green-700" },
  closed: { label: "Fermé", color: "bg-slate-100 text-slate-600" },
  rejected: { label: "Rejeté", color: "bg-red-100 text-red-700" },
};

const URGENCY_CONFIG: Record<string, { label: string; color: string }> = {
  low: { label: "Faible", color: "bg-slate-100 text-slate-600" },
  normal: { label: "Normal", color: "bg-blue-100 text-blue-700" },
  high: { label: "Élevé", color: "bg-amber-100 text-amber-700" },
  critical: { label: "Critique", color: "bg-red-100 text-red-700" },
};

const TYPE_LABELS: Record<string, string> = {
  technical: "Technique", account: "Compte", requests: "Demandes",
  preparation: "Préparation", stock: "Stock", cash: "Caisse", other: "Autre",
};

const ALL_STATUSES = ["new", "reviewing", "processing", "resolved", "closed", "rejected"];
const ALL_URGENCIES = ["low", "normal", "high", "critical"];

export default function AdminTicketsPage() {
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
  const canEdit   = user?.adminAccess || _hasPerm("admin_tickets.edit");
  const canCreate = user?.adminAccess || _hasPerm("admin_tickets.create");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [internalNote, setInternalNote] = useState("");
  const [filters, setFilters] = useState({ status: "", urgency: "", type: "" });
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-tickets", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.status) params.set("status", filters.status);
      if (filters.urgency) params.set("urgency", filters.urgency);
      if (filters.type) params.set("type", filters.type);
      const r = await fetch(`${API}/api/support-tickets?${params}`, { headers: authHeader() });
      if (!r.ok) throw new Error("Erreur");
      return r.json();
    },
  });

  const { data: detail } = useQuery({
    queryKey: ["admin-ticket-detail", selectedId],
    queryFn: async () => {
      const r = await fetch(`${API}/api/support-tickets/${selectedId}`, { headers: authHeader() });
      if (!r.ok) throw new Error("Erreur");
      return r.json();
    },
    enabled: !!selectedId,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...body }: any) => {
      const r = await fetch(`${API}/api/support-tickets/${id}`, {
        method: "PATCH", headers: authHeader(), body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Erreur");
      return d;
    },
    onSuccess: () => {
      toast({ title: "Mis à jour" });
      qc.invalidateQueries({ queryKey: ["admin-tickets"] });
      qc.invalidateQueries({ queryKey: ["admin-ticket-detail", selectedId] });
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const replyMutation = useMutation({
    mutationFn: async ({ id, body, internal }: { id: number; body: string; internal: boolean }) => {
      const r = await fetch(`${API}/api/support-tickets/${id}/replies`, {
        method: "POST", headers: authHeader(), body: JSON.stringify({ body, isInternal: internal }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Erreur");
      return d;
    },
    onSuccess: () => {
      toast({ title: "Réponse envoyée" });
      setReplyBody("");
      setIsInternal(false);
      qc.invalidateQueries({ queryKey: ["admin-ticket-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["admin-tickets"] });
    },
    onError: (e: any) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  if (!user?.adminAccess) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">Accès non autorisé</div>;
  }

  const stats = data?.stats;
  const tickets = data?.tickets ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertCircle className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Tickets utilisateurs</h1>
            <p className="text-sm text-muted-foreground">Gérer et suivre les tickets et demandes</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowFilters(p => !p)} className="flex items-center gap-2">
          <Filter className="h-4 w-4" />
          Filtres
        </Button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Total", value: stats.total, color: "text-foreground" },
            { label: "Nouveaux", value: stats.new_count, color: "text-blue-600" },
            { label: "En traitement", value: stats.processing_count, color: "text-purple-600" },
            { label: "Résolus", value: stats.resolved_count, color: "text-green-600" },
            { label: "Critiques", value: stats.critical_count, color: "text-red-600" },
          ].map(s => (
            <Card key={s.label} className="text-center p-2">
              <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      {showFilters && (
        <Card>
          <CardContent className="p-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="mb-1 block text-xs">Statut</Label>
                <Select value={filters.status || "all"} onValueChange={v => setFilters(p => ({ ...p, status: v === "all" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder="Tous" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous</SelectItem>
                    {ALL_STATUSES.map(s => <SelectItem key={s} value={s}>{STATUS_CONFIG[s]?.label ?? s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1 block text-xs">Urgence</Label>
                <Select value={filters.urgency || "all"} onValueChange={v => setFilters(p => ({ ...p, urgency: v === "all" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder="Toutes" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes</SelectItem>
                    {ALL_URGENCIES.map(u => <SelectItem key={u} value={u}>{URGENCY_CONFIG[u]?.label ?? u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1 block text-xs">Type</Label>
                <Select value={filters.type || "all"} onValueChange={v => setFilters(p => ({ ...p, type: v === "all" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder="Tous" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous</SelectItem>
                    {Object.entries(TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tickets list */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : tickets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 gap-3">
            <AlertCircle className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">Aucun ticket</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {tickets.map((t: any) => {
            const status = STATUS_CONFIG[t.status] ?? STATUS_CONFIG.new;
            const urgency = URGENCY_CONFIG[t.urgency] ?? URGENCY_CONFIG.normal;
            return (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className="w-full text-left border rounded-lg p-3 hover:shadow-md transition-all bg-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${status.color}`}>{status.label}</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${urgency.color}`}>{urgency.label}</span>
                      <span className="text-xs text-muted-foreground">{TYPE_LABELS[t.type] ?? t.type}</span>
                      <span className="text-xs font-mono text-muted-foreground">{t.ticket_ref}</span>
                    </div>
                    <h3 className="font-semibold text-sm">{t.title}</h3>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {t.user_name}{t.worker_name && ` (${t.worker_name})`}{t.branch_name && ` · ${t.branch_name}`}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted-foreground space-y-1">
                    <div>{new Date(t.created_at).toLocaleDateString("fr-FR")}</div>
                    {t.reply_count > 0 && <div className="flex items-center gap-1 text-primary justify-end"><MessageSquare className="h-3 w-3" />{t.reply_count}</div>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selectedId} onOpenChange={o => { if (!o) { setSelectedId(null); setReplyBody(""); setInternalNote(""); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm font-mono">{detail?.ticket?.ticket_ref}</DialogTitle>
          </DialogHeader>
          {detail ? (
            <div className="space-y-4">
              {/* Ticket info */}
              <div className="bg-muted/30 rounded-lg p-3 space-y-1 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  {(() => { const s = STATUS_CONFIG[detail.ticket.status] ?? STATUS_CONFIG.new; return <span className={`text-xs px-2 py-0.5 rounded font-medium ${s.color}`}>{s.label}</span>; })()}
                  {(() => { const u = URGENCY_CONFIG[detail.ticket.urgency] ?? URGENCY_CONFIG.normal; return <span className={`text-xs px-2 py-0.5 rounded font-medium ${u.color}`}>{u.label}</span>; })()}
                  <span className="text-xs text-muted-foreground">{TYPE_LABELS[detail.ticket.type] ?? detail.ticket.type}</span>
                </div>
                <h2 className="font-bold mt-1">{detail.ticket.title}</h2>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{detail.ticket.description}</p>
                <div className="text-xs text-muted-foreground pt-1 border-t mt-2 space-y-0.5">
                  <div>Utilisateur : {detail.ticket.user_name}{detail.ticket.worker_name && ` (${detail.ticket.worker_name})`}</div>
                  <div>Boutique : {detail.ticket.branch_name ?? "—"}</div>
                  <div>Date : {new Date(detail.ticket.created_at).toLocaleString("fr-FR")}</div>
                  {detail.ticket.assignee_name && <div>Assigné à : {detail.ticket.assignee_name}</div>}
                </div>
              </div>

              {/* Status change */}
              {canEdit && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">Changer le statut :</span>
                  <div className="flex gap-1 flex-wrap">
                    {ALL_STATUSES.map(s => (
                      <button
                        key={s}
                        onClick={() => updateMutation.mutate({ id: selectedId, status: s })}
                        className={`text-xs px-2 py-1 rounded font-medium transition-all hover:opacity-80 ${detail.ticket.status === s ? STATUS_CONFIG[s]?.color + " ring-2 ring-current/30" : "bg-muted text-muted-foreground"}`}
                      >
                        {STATUS_CONFIG[s]?.label ?? s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Internal note */}
              {canEdit && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Note interne (invisible pour l'utilisateur)</Label>
                  <div className="flex gap-2">
                    <Input
                      value={internalNote || detail.ticket.internal_note || ""}
                      onChange={e => setInternalNote(e.target.value)}
                      placeholder="Ajouter une note..."
                      className="text-sm"
                    />
                    <Button size="sm" variant="outline" onClick={() => updateMutation.mutate({ id: selectedId, internalNote })}>
                      Enregistrer
                    </Button>
                  </div>
                </div>
              )}

              {/* Replies */}
              {detail.replies?.length > 0 && (
                <div className="space-y-2 border-t pt-3">
                  <h3 className="text-xs font-semibold text-muted-foreground">Conversation</h3>
                  {detail.replies.map((r: any) => (
                    <div key={r.id} className={`rounded-lg p-3 text-sm ${r.is_internal ? "bg-amber-50 border border-amber-200 opacity-80" : r.user_id === detail.ticket.user_id ? "bg-muted ml-6" : "bg-primary/5 mr-6 border border-primary/20"}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-xs">{r.user_name} {r.is_internal && <span className="text-amber-600">(note interne)</span>}</span>
                        <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("fr-FR")}</span>
                      </div>
                      <p className="whitespace-pre-wrap">{r.body}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Reply box */}
              {canCreate && (
                <div className="border-t pt-3 space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium">Répondre :</span>
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                      <input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)} />
                      <span className="text-amber-600">Note interne</span>
                    </label>
                  </div>
                  <Textarea value={replyBody} onChange={e => setReplyBody(e.target.value)} placeholder="Écrivez votre réponse ici..." rows={3} />
                  <Button
                    onClick={() => { if (replyBody.trim()) replyMutation.mutate({ id: selectedId!, body: replyBody, internal: isInternal }); }}
                    disabled={replyMutation.isPending || !replyBody.trim()}
                    className="flex items-center gap-2" size="sm"
                  >
                    {replyMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    Envoyer {isInternal ? "la note" : "la réponse"}
                  </Button>
                </div>
              )}
            </div>
          ) : <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
