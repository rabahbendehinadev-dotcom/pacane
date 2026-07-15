import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, Send, Plus, Loader2, MessageSquare, CheckCircle2, Clock, XCircle } from "lucide-react";
import { useLocation } from "wouter";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");
function authHeader() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` };
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  new: { label: "جديد", color: "bg-blue-100 text-blue-700", icon: Clock },
  reviewing: { label: "قيد المراجعة", color: "bg-amber-100 text-amber-700", icon: Clock },
  processing: { label: "قيد المعالجة", color: "bg-purple-100 text-purple-700", icon: Clock },
  resolved: { label: "تم الحل", color: "bg-green-100 text-green-700", icon: CheckCircle2 },
  closed: { label: "مغلق", color: "bg-slate-100 text-slate-600", icon: XCircle },
  rejected: { label: "مرفوض", color: "bg-red-100 text-red-700", icon: XCircle },
};

const URGENCY_CONFIG: Record<string, { label: string; color: string }> = {
  low: { label: "منخفض", color: "bg-slate-100 text-slate-600" },
  normal: { label: "عادي", color: "bg-blue-100 text-blue-700" },
  high: { label: "مرتفع", color: "bg-amber-100 text-amber-700" },
  critical: { label: "حرج", color: "bg-red-100 text-red-700" },
};

const TYPE_LABELS: Record<string, string> = {
  technical: "تقنية", account: "حساب", requests: "طلبات",
  preparation: "تحضير", stock: "مخزون", cash: "صندوق", other: "أخرى",
};

export default function MyTicketsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [replyBody, setReplyBody] = useState("");

  const { data: tickets, isLoading } = useQuery({
    queryKey: ["my-tickets"],
    queryFn: async () => {
      const r = await fetch(`${API}/api/support-tickets/my`, { headers: authHeader() });
      if (!r.ok) throw new Error("Erreur");
      return r.json();
    },
  });

  const { data: detail } = useQuery({
    queryKey: ["ticket-detail", selectedId],
    queryFn: async () => {
      const r = await fetch(`${API}/api/support-tickets/${selectedId}`, { headers: authHeader() });
      if (!r.ok) throw new Error("Erreur");
      return r.json();
    },
    enabled: !!selectedId,
  });

  const replyMutation = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: string }) => {
      const r = await fetch(`${API}/api/support-tickets/${id}/replies`, {
        method: "POST", headers: authHeader(), body: JSON.stringify({ body }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Erreur");
      return d;
    },
    onSuccess: () => {
      toast({ title: "تم إرسال الرد" });
      setReplyBody("");
      qc.invalidateQueries({ queryKey: ["ticket-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["my-tickets"] });
    },
    onError: (e: any) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  return (
    <div dir="rtl" className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertCircle className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">بلاغاتي</h1>
            <p className="text-sm text-muted-foreground">تتبع جميع بلاغاتك ومتابعة الردود</p>
          </div>
        </div>
        <Button onClick={() => navigate("/report-problem")} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          بلاغ جديد
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : !tickets?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 gap-3">
            <AlertCircle className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">لا توجد بلاغات</p>
            <Button onClick={() => navigate("/report-problem")}>إرسال بلاغ</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {(tickets || []).map((t: any) => {
            const status = STATUS_CONFIG[t.status] ?? STATUS_CONFIG.new;
            const urgency = URGENCY_CONFIG[t.urgency] ?? URGENCY_CONFIG.normal;
            return (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className="w-full text-right border rounded-lg p-4 hover:shadow-md transition-all bg-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${status.color}`}>{status.label}</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${urgency.color}`}>{urgency.label}</span>
                      <span className="text-xs text-muted-foreground">{TYPE_LABELS[t.type] ?? t.type}</span>
                    </div>
                    <div className="font-mono text-xs text-muted-foreground mb-1">{t.ticket_ref}</div>
                    <h3 className="font-semibold text-sm">{t.title}</h3>
                    <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{t.description}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleDateString("ar-DZ")}</div>
                    {t.reply_count > 0 && (
                      <div className="flex items-center gap-1 text-xs text-primary mt-1">
                        <MessageSquare className="h-3 w-3" />{t.reply_count} رد
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selectedId} onOpenChange={o => { if (!o) { setSelectedId(null); setReplyBody(""); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-mono">
              {detail?.ticket?.ticket_ref}
            </DialogTitle>
          </DialogHeader>
          {detail ? (
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  {(() => { const s = STATUS_CONFIG[detail.ticket.status] ?? STATUS_CONFIG.new; return <span className={`text-xs px-2 py-0.5 rounded font-medium ${s.color}`}>{s.label}</span>; })()}
                  {(() => { const u = URGENCY_CONFIG[detail.ticket.urgency] ?? URGENCY_CONFIG.normal; return <span className={`text-xs px-2 py-0.5 rounded font-medium ${u.color}`}>{u.label}</span>; })()}
                </div>
                <h2 className="font-bold">{detail.ticket.title}</h2>
                <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap leading-relaxed">{detail.ticket.description}</p>
                <div className="text-xs text-muted-foreground mt-2">
                  {new Date(detail.ticket.created_at).toLocaleString("ar-DZ")}
                  {detail.ticket.branch_name && ` · ${detail.ticket.branch_name}`}
                </div>
              </div>

              {/* Replies */}
              {detail.replies?.length > 0 && (
                <div className="space-y-3 border-t pt-4">
                  <h3 className="text-sm font-semibold text-muted-foreground">الردود</h3>
                  {detail.replies.map((r: any) => (
                    <div key={r.id} className={`rounded-lg p-3 text-sm ${r.user_id === detail.ticket.user_id ? "bg-muted mr-8" : "bg-primary/5 ml-8 border border-primary/20"}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-xs">{r.user_name}</span>
                        <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("ar-DZ")}</span>
                      </div>
                      <p className="whitespace-pre-wrap">{r.body}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Reply box — only if not closed/resolved */}
              {!["closed", "resolved", "rejected"].includes(detail.ticket.status) && (
                <div className="border-t pt-4 space-y-2">
                  <Textarea
                    value={replyBody}
                    onChange={e => setReplyBody(e.target.value)}
                    placeholder="اكتب ردك هنا..."
                    rows={3}
                  />
                  <Button
                    onClick={() => { if (replyBody.trim()) replyMutation.mutate({ id: selectedId!, body: replyBody }); }}
                    disabled={replyMutation.isPending || !replyBody.trim()}
                    className="flex items-center gap-2"
                    size="sm"
                  >
                    {replyMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    إرسال الرد
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
