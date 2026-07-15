import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Bell, CheckCheck, AlertTriangle, AlertCircle, Megaphone, ClipboardList, Info, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");
function authHeader() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` };
}

const TYPE_ICONS: Record<string, any> = {
  normal: Info,
  important: AlertCircle,
  warning: AlertTriangle,
  work_instructions: ClipboardList,
  admin_announcement: Megaphone,
};

const TYPE_COLORS: Record<string, string> = {
  normal: "border-slate-200 bg-slate-50",
  important: "border-blue-200 bg-blue-50",
  warning: "border-amber-200 bg-amber-50",
  work_instructions: "border-purple-200 bg-purple-50",
  admin_announcement: "border-indigo-200 bg-indigo-50",
};

const PRIORITY_COLORS: Record<string, string> = {
  normal: "bg-slate-100 text-slate-700",
  important: "bg-blue-100 text-blue-700",
  urgent: "bg-red-100 text-red-700",
};

const PRIORITY_LABELS: Record<string, string> = { normal: "عادي", important: "مهم", urgent: "عاجل" };
const TYPE_LABELS: Record<string, string> = {
  normal: "إشعار عادي", important: "تنبيه مهم", warning: "تحذير",
  work_instructions: "تعليمات عمل", admin_announcement: "إعلان إداري",
};

export default function MyNotificationsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<any>(null);
  const [pendingAck, setPendingAck] = useState<any[]>([]);
  const [ackIdx, setAckIdx] = useState(0);
  const [acking, setAcking] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["my-worker-notifications"],
    queryFn: async () => {
      const r = await fetch(`${API}/api/worker-notifications/my`, { headers: authHeader() });
      if (!r.ok) throw new Error("Erreur");
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const { data: pendingData } = useQuery({
    queryKey: ["my-pending-ack"],
    queryFn: async () => {
      const r = await fetch(`${API}/api/worker-notifications/pending-acknowledgment`, { headers: authHeader() });
      if (!r.ok) return [];
      return r.json();
    },
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (pendingData?.length) {
      setPendingAck(pendingData);
      setAckIdx(0);
    }
  }, [pendingData]);

  const readMutation = useMutation({
    mutationFn: async (recipientId: number) => {
      await fetch(`${API}/api/worker-notifications/recipients/${recipientId}/read`, { method: "PATCH", headers: authHeader() });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-worker-notifications"] }),
  });

  const ackMutation = useMutation({
    mutationFn: async (recipientId: number) => {
      const r = await fetch(`${API}/api/worker-notifications/recipients/${recipientId}/acknowledge`, { method: "POST", headers: authHeader() });
      if (!r.ok) throw new Error("Erreur");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-worker-notifications"] });
      qc.invalidateQueries({ queryKey: ["my-pending-ack"] });
    },
  });

  async function handleAck(recipientId: number) {
    setAcking(true);
    await ackMutation.mutateAsync(recipientId);
    setAcking(false);
    if (ackIdx + 1 < pendingAck.length) {
      setAckIdx(i => i + 1);
    } else {
      setPendingAck([]);
    }
  }

  function openNotif(n: any) {
    setSelected(n);
    if (!n.read_at) {
      readMutation.mutate(n.recipient_id);
    }
  }

  const notifications = data?.notifications ?? [];
  const unread = data?.unread ?? 0;
  const currentAck = pendingAck[ackIdx];

  return (
    <div dir="rtl" className="space-y-6 max-w-3xl mx-auto">
      {/* Urgent acknowledgment modal */}
      {currentAck && (
        <Dialog open={true}>
          <DialogContent dir="rtl" className={`border-2 ${currentAck.priority === "urgent" ? "border-red-400" : "border-blue-400"}`}>
            <DialogHeader>
              <DialogTitle className={`flex items-center gap-2 ${currentAck.priority === "urgent" ? "text-red-700" : "text-blue-700"}`}>
                <AlertTriangle className="h-5 w-5" />
                {currentAck.priority === "urgent" ? "إشعار عاجل يستوجب الاطلاع" : "إشعار مهم يستوجب الاطلاع"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <h3 className="font-bold text-base">{currentAck.title}</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{currentAck.body}</p>
              <div className="text-xs text-muted-foreground">بواسطة: {currentAck.sender_name} — {new Date(currentAck.created_at).toLocaleString("ar-DZ")}</div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => handleAck(currentAck.recipient_id)}
                disabled={acking}
                className={`w-full text-base py-3 ${currentAck.priority === "urgent" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"}`}
              >
                {acking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4 ml-2" />}
                قرأت واطلعت
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Bell className="h-6 w-6 text-primary" />
            {unread > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-bold">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </div>
          <div>
            <h1 className="text-2xl font-bold">إشعاراتي</h1>
            <p className="text-sm text-muted-foreground">{unread > 0 ? `${unread} إشعار غير مقروء` : "جميع الإشعارات مقروءة"}</p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : notifications.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
            <Bell className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">لا توجد إشعارات</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map((n: any) => {
            const IconComp = TYPE_ICONS[n.type] ?? Info;
            const isUnread = !n.read_at;
            return (
              <button
                key={n.recipient_id}
                onClick={() => openNotif(n)}
                className={`w-full text-right border rounded-lg p-3 transition-all hover:shadow-md ${TYPE_COLORS[n.type] ?? TYPE_COLORS.normal} ${isUnread ? "ring-2 ring-primary/30" : "opacity-80"}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 p-2 rounded-full shrink-0 ${n.priority === "urgent" ? "bg-red-100" : n.priority === "important" ? "bg-blue-100" : "bg-slate-100"}`}>
                    <IconComp className={`h-4 w-4 ${n.priority === "urgent" ? "text-red-600" : n.priority === "important" ? "text-blue-600" : "text-slate-600"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${PRIORITY_COLORS[n.priority] ?? PRIORITY_COLORS.normal}`}>{PRIORITY_LABELS[n.priority] ?? n.priority}</span>
                      {isUnread && <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded">جديد</span>}
                      {n.acknowledged_at && <span className="text-xs text-green-700">✓ اطلعت</span>}
                    </div>
                    <h3 className={`text-sm font-semibold ${isUnread ? "text-foreground" : "text-muted-foreground"}`}>{n.title}</h3>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.body}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span>{n.sender_name}</span>
                      <span>·</span>
                      <span>{new Date(n.created_at).toLocaleString("ar-DZ")}</span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={o => { if (!o) setSelected(null); }}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selected && (() => { const I = TYPE_ICONS[selected.type] ?? Info; return <I className="h-5 w-5" />; })()}
              {selected?.title}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${PRIORITY_COLORS[selected.priority] ?? PRIORITY_COLORS.normal}`}>{PRIORITY_LABELS[selected.priority] ?? selected.priority}</span>
                <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">{TYPE_LABELS[selected.type] ?? selected.type}</span>
                {selected.acknowledged_at && <span className="text-xs text-green-700">✓ تأكيد الاطلاع: {new Date(selected.acknowledged_at).toLocaleString("ar-DZ")}</span>}
              </div>
              {selected.image_url && <img src={selected.image_url} alt="" className="rounded-lg max-h-48 w-full object-cover" />}
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{selected.body}</p>
              <div className="text-xs text-muted-foreground pt-2 border-t">
                <div>المرسل: {selected.sender_name}</div>
                <div>التاريخ: {new Date(selected.created_at).toLocaleString("ar-DZ")}</div>
                {selected.read_at && <div>قُرئ: {new Date(selected.read_at).toLocaleString("ar-DZ")}</div>}
              </div>
              {!selected.acknowledged_at && ["urgent", "important"].includes(selected.priority) && (
                <Button
                  onClick={() => { handleAck(selected.recipient_id); setSelected(null); }}
                  disabled={acking}
                  className="w-full"
                >
                  <CheckCheck className="h-4 w-4 ml-2" />
                  قرأت واطلعت
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
