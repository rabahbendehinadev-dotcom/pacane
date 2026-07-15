import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, CheckCircle2, Send, Loader2 } from "lucide-react";
import { useLocation } from "wouter";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");
function authHeader() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` };
}

const PROBLEM_TYPES = [
  { value: "technical", label: "تقنية" },
  { value: "account", label: "حساب" },
  { value: "requests", label: "طلبات" },
  { value: "preparation", label: "تحضير" },
  { value: "stock", label: "مخزون" },
  { value: "cash", label: "صندوق" },
  { value: "other", label: "أخرى" },
];

const URGENCY_LEVELS = [
  { value: "low", label: "منخفض", color: "text-slate-600" },
  { value: "normal", label: "عادي", color: "text-blue-600" },
  { value: "high", label: "مرتفع", color: "text-amber-600" },
  { value: "critical", label: "حرج", color: "text-red-600" },
];

export default function ReportProblemPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [submitted, setSubmitted] = useState<any>(null);

  const [form, setForm] = useState({
    title: "",
    type: "other",
    description: "",
    urgency: "normal",
    fileUrl: "",
  });

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch(`${API}/api/support-tickets`, {
        method: "POST", headers: authHeader(), body: JSON.stringify(data),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Erreur");
      return d;
    },
    onSuccess: (d) => {
      setSubmitted(d);
      toast({ title: "تم إرسال البلاغ", description: `رقمك المرجعي: ${d.ticket_ref}` });
    },
    onError: (e: any) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.description.trim()) {
      toast({ title: "الرجاء ملء جميع الحقول المطلوبة", variant: "destructive" });
      return;
    }
    mutation.mutate(form);
  }

  if (submitted) {
    return (
      <div dir="rtl" className="max-w-lg mx-auto py-8">
        <Card className="border-green-200 bg-green-50">
          <CardContent className="flex flex-col items-center py-10 gap-4 text-center">
            <CheckCircle2 className="h-16 w-16 text-green-600" />
            <h2 className="text-xl font-bold text-green-800">تم إرسال البلاغ بنجاح</h2>
            <p className="text-muted-foreground">رقمك المرجعي:</p>
            <div className="bg-white border border-green-300 rounded-lg px-6 py-3 text-2xl font-mono font-bold text-green-700">
              {submitted.ticket_ref}
            </div>
            <p className="text-sm text-muted-foreground">احتفظ بهذا الرقم لمتابعة بلاغك. ستصلك إشعارات عند الرد.</p>
            <div className="flex gap-3 flex-wrap justify-center">
              <Button onClick={() => navigate("/my-tickets")}>متابعة بلاغاتي</Button>
              <Button variant="outline" onClick={() => { setSubmitted(null); setForm({ title: "", type: "other", description: "", urgency: "normal", fileUrl: "" }); }}>
                بلاغ جديد
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div dir="rtl" className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <AlertCircle className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">تبليغ عن مشكلة</h1>
          <p className="text-sm text-muted-foreground">أرسل بلاغاً وستتابعه الإدارة وترد عليك</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader><CardTitle className="text-base">تفاصيل المشكلة</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {/* User info (auto-filled) */}
            <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-24">المستخدم:</span>
                <span className="font-medium">{(user as any)?.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-24">الحساب:</span>
                <span className="font-medium">{(user as any)?.email || (user as any)?.username}</span>
              </div>
            </div>

            {/* Title */}
            <div>
              <Label className="mb-1.5 block">عنوان المشكلة *</Label>
              <Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="وصف مختصر للمشكلة..." required />
            </div>

            {/* Type + Urgency */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="mb-1.5 block">نوع المشكلة</Label>
                <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROBLEM_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block">درجة الاستعجال</Label>
                <Select value={form.urgency} onValueChange={v => setForm(p => ({ ...p, urgency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {URGENCY_LEVELS.map(u => (
                      <SelectItem key={u.value} value={u.value}>
                        <span className={u.color}>{u.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Description */}
            <div>
              <Label className="mb-1.5 block">وصف مفصل للمشكلة *</Label>
              <Textarea
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                rows={5}
                placeholder="اشرح المشكلة بالتفصيل، متى حدثت، وماذا كنت تحاول أن تفعل..."
                required
              />
            </div>

            <Button type="submit" disabled={mutation.isPending} className="w-full flex items-center gap-2 py-3">
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              إرسال البلاغ
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
