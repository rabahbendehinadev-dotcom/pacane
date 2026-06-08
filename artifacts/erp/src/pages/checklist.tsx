import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardCheck, Plus, Edit2, Trash2, CheckCircle2, Circle, AlertCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const AUTH = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("erp_token")}`,
});

interface Task {
  id: number;
  title: string;
  description: string | null;
  sortOrder: number;
  isDone?: boolean;
  isDoneToday?: boolean;
  assignedToUserId?: number;
  assignedToUserName?: string;
  isActive?: boolean;
}

interface SimpleUser {
  id: number;
  name: string;
  username: string;
}

function hasPerm(userPerms: string[], p: string): boolean {
  if (userPerms.includes("*")) return true;
  if (userPerms.includes(p)) return true;
  const mod = p.split(".")[0];
  return userPerms.includes(`${mod}.*`);
}

export default function ChecklistPage() {
  const { user } = useAuth();
  const perms: string[] = (user as any)?.permissions ?? [];
  const isAdmin = !!(user as any)?.adminAccess;
  const canManage = isAdmin || hasPerm(perms, "checklist.manage");

  return canManage ? <AdminView /> : <WorkerView />;
}

// ─── Worker View ─────────────────────────────────────────────────────────────
function WorkerView() {
  const qc = useQueryClient();
  const [toggling, setToggling] = useState<number | null>(null);

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ["checklist-my"],
    queryFn: async () => {
      const r = await fetch("/api/checklist/my", { headers: AUTH() });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const today = new Date().toLocaleDateString("ar-DZ", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  async function toggle(task: Task) {
    setToggling(task.id);
    try {
      const action = task.isDone ? "uncomplete" : "complete";
      const r = await fetch(`/api/checklist/${task.id}/${action}`, { method: "POST", headers: AUTH() });
      if (!r.ok) throw new Error((await r.json()).error);
      qc.invalidateQueries({ queryKey: ["checklist-my"] });
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally {
      setToggling(null);
    }
  }

  const doneCount = tasks.filter(t => t.isDone).length;

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
          <ClipboardCheck className="h-6 w-6 text-primary" />
          قائمة مهامي
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{today}</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <ClipboardCheck className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">لا توجد مهام مخصّصة لك</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between text-sm text-muted-foreground px-1">
            <span>{doneCount} من {tasks.length} مهمة مُنجزة</span>
            {doneCount === tasks.length && tasks.length > 0 && (
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> أُنجز الكل!
              </Badge>
            )}
          </div>

          <div className="space-y-2">
            {tasks.map(task => (
              <button
                key={task.id}
                onClick={() => toggle(task)}
                disabled={toggling === task.id}
                className={`w-full flex items-start gap-3 p-4 rounded-lg border transition-all text-right ${
                  task.isDone
                    ? "bg-emerald-50 border-emerald-200"
                    : "bg-card border-border hover:border-primary/40 hover:bg-accent/30"
                }`}
              >
                <span className="mt-0.5 shrink-0">
                  {toggling === task.id ? (
                    <span className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin inline-block" />
                  ) : task.isDone ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground/50" />
                  )}
                </span>
                <div className="flex-1 min-w-0 text-right">
                  <p className={`font-medium text-sm leading-snug ${task.isDone ? "line-through text-muted-foreground" : ""}`}>
                    {task.title}
                  </p>
                  {task.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Admin View ───────────────────────────────────────────────────────────────
function AdminView() {
  const qc = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formUserId, setFormUserId] = useState("");
  const [formOrder, setFormOrder] = useState("0");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  const { data: users = [] } = useQuery<SimpleUser[]>({
    queryKey: ["checklist-users"],
    queryFn: async () => {
      const r = await fetch("/api/checklist/users", { headers: AUTH() });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ["checklist-all", selectedUserId],
    queryFn: async () => {
      const url = selectedUserId && selectedUserId !== "all" ? `/api/checklist?userId=${selectedUserId}` : "/api/checklist";
      const r = await fetch(url, { headers: AUTH() });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  function openNew() {
    setEditing(null);
    setFormTitle("");
    setFormDesc("");
    setFormUserId(selectedUserId !== "all" ? selectedUserId : (users[0]?.id.toString() ?? ""));
    setFormOrder("0");
    setDialogOpen(true);
  }

  function openEdit(task: Task) {
    setEditing(task);
    setFormTitle(task.title);
    setFormDesc(task.description ?? "");
    setFormUserId(task.assignedToUserId?.toString() ?? "");
    setFormOrder(task.sortOrder.toString());
    setDialogOpen(true);
  }

  async function save() {
    if (!formTitle.trim()) { toast({ title: "العنوان مطلوب", variant: "destructive" }); return; }
    if (!formUserId) { toast({ title: "اختر عاملاً", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const body = {
        title: formTitle.trim(),
        description: formDesc.trim() || null,
        assignedToUserId: parseInt(formUserId, 10),
        sortOrder: parseInt(formOrder, 10) || 0,
      };
      if (editing) {
        const r = await fetch(`/api/checklist/${editing.id}`, { method: "PATCH", headers: AUTH(), body: JSON.stringify(body) });
        if (!r.ok) throw new Error((await r.json()).error);
        toast({ title: "تمّ التعديل" });
      } else {
        const r = await fetch("/api/checklist", { method: "POST", headers: AUTH(), body: JSON.stringify(body) });
        if (!r.ok) throw new Error((await r.json()).error);
        toast({ title: "تمّت الإضافة" });
      }
      qc.invalidateQueries({ queryKey: ["checklist-all"] });
      setDialogOpen(false);
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function deleteTask(id: number) {
    setDeleting(id);
    try {
      const r = await fetch(`/api/checklist/${id}`, { method: "DELETE", headers: AUTH() });
      if (!r.ok) throw new Error((await r.json()).error);
      toast({ title: "تمّ الحذف" });
      qc.invalidateQueries({ queryKey: ["checklist-all"] });
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally { setDeleting(null); }
  }

  const grouped = tasks.reduce<Record<string, Task[]>>((acc, t) => {
    const key = `${t.assignedToUserId}__${t.assignedToUserName ?? "—"}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {});

  const today = new Date().toLocaleDateString("ar-DZ", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-primary" />
            إدارة مهام العاملين
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{today}</p>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" /> إضافة مهمة
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Select value={selectedUserId} onValueChange={setSelectedUserId}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="جميع العاملين" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">جميع العاملين</SelectItem>
            {users.map(u => (
              <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{tasks.length} مهمة</span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <AlertCircle className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-muted-foreground">لا توجد مهام. أضف مهمة للبدء.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([key, userTasks]) => {
            const [, userName] = key.split("__");
            const doneCount = userTasks.filter(t => t.isDoneToday).length;
            return (
              <Card key={key}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{userName}</CardTitle>
                    <span className="text-xs text-muted-foreground">
                      {doneCount}/{userTasks.length} اليوم
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {userTasks.map(task => (
                      <div key={task.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30">
                        <span className="shrink-0">
                          {task.isDoneToday
                            ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            : <Circle className="h-4 w-4 text-muted-foreground/40" />
                          }
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{task.title}</p>
                          {task.description && (
                            <p className="text-xs text-muted-foreground">{task.description}</p>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground/50 shrink-0">#{task.sortOrder}</span>
                        <div className="flex gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(task)}>
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => deleteTask(task.id)}
                            disabled={deleting === task.id}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل المهمة" : "مهمة جديدة"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>العنوان <span className="text-destructive">*</span></Label>
              <Input
                className="mt-1"
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
                placeholder="مثال: تنظيف محطة العمل"
                autoFocus
              />
            </div>
            <div>
              <Label>وصف إضافي (اختياري)</Label>
              <Textarea
                className="mt-1 resize-none"
                rows={2}
                value={formDesc}
                onChange={e => setFormDesc(e.target.value)}
                placeholder="تفاصيل إضافية..."
              />
            </div>
            <div>
              <Label>العامل <span className="text-destructive">*</span></Label>
              <Select value={formUserId} onValueChange={setFormUserId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="اختر عاملاً" />
                </SelectTrigger>
                <SelectContent>
                  {users.map(u => (
                    <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>الترتيب</Label>
              <Input
                className="mt-1"
                type="number"
                min="0"
                value={formOrder}
                onChange={e => setFormOrder(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            <Button onClick={save} disabled={saving || !formTitle.trim() || !formUserId}>
              {saving ? "جارٍ الحفظ..." : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
