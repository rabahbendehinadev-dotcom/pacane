import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ClipboardCheck, Plus, Edit2, Trash2, CheckCircle2, Circle, AlertCircle, Users, TrendingUp, RepeatIcon, Search, ChevronsUpDown, Check, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const AUTH = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("erp_token")}`,
});

const DAY_NAMES = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

type RecurrenceType = "daily" | "weekly" | "specific_days";

interface Task {
  id: number;
  title: string;
  description: string | null;
  sortOrder: number;
  recurrence: RecurrenceType;
  recurringDays: number[];
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

interface WorkerSummary {
  userId: number;
  userName: string;
  total: number;
  done: number;
}

interface DailySummary {
  date: string;
  totalWorkers: number;
  workersCompleted: number;
  totalTasks: number;
  totalDone: number;
  workers: WorkerSummary[];
}

function hasPerm(userPerms: string[], p: string): boolean {
  if (userPerms.includes("*")) return true;
  if (userPerms.includes(p)) return true;
  const mod = p.split(".")[0];
  return userPerms.includes(`${mod}.*`);
}

function recurrenceLabel(recurrence: RecurrenceType, recurringDays: number[]): string {
  if (recurrence === "daily") return "Quotidien";
  if (recurrence === "weekly") {
    if (recurringDays.length === 1) return `Hebdo (${DAY_NAMES[recurringDays[0]]})`;
    return "Hebdomadaire";
  }
  if (recurringDays.length === 0) return "Jours spécifiques";
  return recurringDays.map(d => DAY_NAMES[d]).join(", ");
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

  const today = new Date().toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  async function toggle(task: Task) {
    setToggling(task.id);
    try {
      const action = task.isDone ? "uncomplete" : "complete";
      const r = await fetch(`/api/checklist/${task.id}/${action}`, { method: "POST", headers: AUTH() });
      if (!r.ok) throw new Error((await r.json()).error);
      qc.invalidateQueries({ queryKey: ["checklist-my"] });
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
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
          Mes tâches
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
            <p className="text-muted-foreground">Aucune tâche assignée pour aujourd'hui</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between text-sm text-muted-foreground px-1">
            <span>{doneCount} / {tasks.length} tâche{tasks.length !== 1 ? "s" : ""} accomplie{doneCount !== 1 ? "s" : ""}</span>
            {doneCount === tasks.length && tasks.length > 0 && (
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> Tout accompli !
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

// ─── Daily Summary Card ───────────────────────────────────────────────────────
function DailySummaryCard() {
  const { data: summary, isLoading } = useQuery<DailySummary>({
    queryKey: ["checklist-summary"],
    queryFn: async () => {
      const r = await fetch("/api/checklist/summary", { headers: AUTH() });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-4 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </CardContent>
      </Card>
    );
  }

  if (!summary || summary.totalWorkers === 0) return null;

  const overallPct = summary.totalTasks > 0 ? Math.round((summary.totalDone / summary.totalTasks) * 100) : 0;

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Résumé du jour
          </CardTitle>
          <div className="flex items-center gap-3 text-sm">
            <span className="flex items-center gap-1 text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              {summary.workersCompleted}/{summary.totalWorkers} ouvrier{summary.totalWorkers !== 1 ? "s" : ""}
            </span>
            <Badge
              className={
                overallPct === 100
                  ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                  : overallPct >= 50
                  ? "bg-amber-100 text-amber-700 hover:bg-amber-100"
                  : "bg-rose-100 text-rose-700 hover:bg-rose-100"
              }
            >
              {overallPct}%
            </Badge>
          </div>
        </div>
        <div className="mt-2 space-y-1">
          <Progress value={overallPct} className="h-2" />
          <p className="text-xs text-muted-foreground text-left">
            {summary.totalDone} / {summary.totalTasks} tâche{summary.totalTasks !== 1 ? "s" : ""} accomplie{summary.totalDone !== 1 ? "s" : ""}
          </p>
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {summary.workers.map(w => {
            const pct = w.total > 0 ? Math.round((w.done / w.total) * 100) : 0;
            const allDone = w.total > 0 && w.done === w.total;
            return (
              <div key={w.userId} className="flex items-center gap-2 min-w-0">
                <div className="shrink-0">
                  {allDone
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    : <Circle className="h-4 w-4 text-muted-foreground/40" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium truncate">{w.userName}</span>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">{w.done}/{w.total}</span>
                  </div>
                  <Progress
                    value={pct}
                    className={`h-1.5 ${allDone ? "[&>div]:bg-emerald-500" : ""}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Recurrence Days Picker ──────────────────────────────────────────────────
function DaysPicker({ selected, onChange }: { selected: number[]; onChange: (days: number[]) => void }) {
  function toggle(d: number) {
    if (selected.includes(d)) {
      onChange(selected.filter(x => x !== d));
    } else {
      onChange([...selected, d].sort());
    }
  }
  return (
    <div className="flex gap-1.5 flex-wrap mt-1">
      {DAY_NAMES.map((name, i) => (
        <button
          key={i}
          type="button"
          onClick={() => toggle(i)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
            selected.includes(i)
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background border-border text-muted-foreground hover:border-primary/50"
          }`}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

// ─── Admin View ───────────────────────────────────────────────────────────────
function AdminView() {
  const qc = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState<string>("all");
  const [searchText, setSearchText] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [formTitles, setFormTitles] = useState<string[]>([""]);
  const [formDesc, setFormDesc] = useState("");
  const [formUserId, setFormUserId] = useState("");
  const [formOrder, setFormOrder] = useState("0");
  const [formRecurrence, setFormRecurrence] = useState<RecurrenceType>("daily");
  const [formDays, setFormDays] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [userComboOpen, setUserComboOpen] = useState(false);

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
    setFormTitles([""]);
    setFormDesc("");
    setFormUserId(selectedUserId !== "all" ? selectedUserId : (users[0]?.id.toString() ?? ""));
    setFormOrder("0");
    setFormRecurrence("daily");
    setFormDays([]);
    setDialogOpen(true);
  }

  function openEdit(task: Task) {
    setEditing(task);
    setFormTitles([task.title]);
    setFormDesc(task.description ?? "");
    setFormUserId(task.assignedToUserId?.toString() ?? "");
    setFormOrder(task.sortOrder.toString());
    setFormRecurrence((task.recurrence as RecurrenceType) ?? "daily");
    setFormDays(task.recurringDays ?? []);
    setDialogOpen(true);
  }

  async function save() {
    const validTitles = formTitles.map(t => t.trim()).filter(Boolean);
    if (validTitles.length === 0) { toast({ title: "Le titre est requis", variant: "destructive" }); return; }
    if (!formUserId) { toast({ title: "Veuillez choisir un utilisateur", variant: "destructive" }); return; }
    if (formRecurrence !== "daily" && formDays.length === 0) {
      toast({ title: "Sélectionnez au moins un jour", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const baseBody = {
        description: formDesc.trim() || null,
        assignedToUserId: parseInt(formUserId, 10),
        sortOrder: parseInt(formOrder, 10) || 0,
        recurrence: formRecurrence,
        recurringDays: formRecurrence !== "daily" ? formDays : [],
      };
      if (editing) {
        const r = await fetch(`/api/checklist/${editing.id}`, { method: "PATCH", headers: AUTH(), body: JSON.stringify({ ...baseBody, title: validTitles[0] }) });
        if (!r.ok) throw new Error((await r.json()).error);
        toast({ title: "Tâche modifiée" });
      } else {
        await Promise.all(validTitles.map(title =>
          fetch("/api/checklist", { method: "POST", headers: AUTH(), body: JSON.stringify({ ...baseBody, title }) })
            .then(async r => { if (!r.ok) throw new Error((await r.json()).error); })
        ));
        toast({ title: validTitles.length > 1 ? `${validTitles.length} tâches ajoutées` : "Tâche ajoutée" });
      }
      qc.invalidateQueries({ queryKey: ["checklist-all"] });
      setDialogOpen(false);
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function deleteTask(id: number) {
    setDeleting(id);
    try {
      const r = await fetch(`/api/checklist/${id}`, { method: "DELETE", headers: AUTH() });
      if (!r.ok) throw new Error((await r.json()).error);
      toast({ title: "Tâche supprimée" });
      qc.invalidateQueries({ queryKey: ["checklist-all"] });
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally { setDeleting(null); }
  }

  const filteredTasks = searchText.trim()
    ? tasks.filter(t => t.title.toLowerCase().includes(searchText.toLowerCase()))
    : tasks;

  const grouped = filteredTasks.reduce<Record<string, Task[]>>((acc, t) => {
    const key = `${t.assignedToUserId}__${t.assignedToUserName ?? "—"}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {});

  const today = new Date().toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-primary" />
            Gestion des tâches
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{today}</p>
        </div>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" /> Ajouter une tâche
        </Button>
      </div>

      <DailySummaryCard />

      <div className="flex items-center gap-3 flex-wrap">
        <Select value={selectedUserId} onValueChange={setSelectedUserId}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Tous les utilisateurs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les utilisateurs</SelectItem>
            {users.map(u => (
              <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Rechercher une tâche..."
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <span className="text-sm text-muted-foreground whitespace-nowrap">{filteredTasks.length} tâche{filteredTasks.length !== 1 ? "s" : ""}</span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <AlertCircle className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-muted-foreground">Aucune tâche. Ajoutez-en une pour commencer.</p>
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
                      {doneCount}/{userTasks.length} aujourd'hui
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
                          <div className="flex items-center gap-1 mt-0.5">
                            <RepeatIcon className="h-3 w-3 text-muted-foreground/50" />
                            <span className="text-xs text-muted-foreground/70">
                              {recurrenceLabel(task.recurrence as RecurrenceType, task.recurringDays ?? [])}
                            </span>
                          </div>
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
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifier la tâche" : "Nouvelle tâche"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>Titre <span className="text-destructive">*</span></Label>
                {!editing && (
                  <button
                    type="button"
                    onClick={() => setFormTitles(t => [...t, ""])}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Plus className="h-3.5 w-3.5" /> Ajouter un titre
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {formTitles.map((title, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    {!editing && formTitles.length > 1 && (
                      <span className="text-xs text-muted-foreground font-mono w-5 text-right shrink-0">{i + 1}.</span>
                    )}
                    <Input
                      className="flex-1"
                      value={title}
                      onChange={e => setFormTitles(ts => ts.map((t, idx) => idx === i ? e.target.value : t))}
                      placeholder="Ex : nettoyage du poste de travail"
                      autoFocus={i === 0}
                    />
                    {!editing && formTitles.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setFormTitles(ts => ts.filter((_, idx) => idx !== i))}
                        className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <Label>Description (facultatif)</Label>
              <Textarea
                className="mt-1 resize-none"
                rows={2}
                value={formDesc}
                onChange={e => setFormDesc(e.target.value)}
                placeholder="Détails supplémentaires..."
              />
            </div>
            <div>
              <Label>Utilisateur <span className="text-destructive">*</span></Label>
              <Popover open={userComboOpen} onOpenChange={setUserComboOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={userComboOpen}
                    className="mt-1 w-full justify-between font-normal"
                  >
                    {formUserId
                      ? (users.find(u => u.id.toString() === formUserId)?.name ?? "Choisir un utilisateur")
                      : "Choisir un utilisateur"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Rechercher un utilisateur..." />
                    <CommandList>
                      <CommandEmpty>Aucun utilisateur trouvé.</CommandEmpty>
                      <CommandGroup>
                        {users.map(u => (
                          <CommandItem
                            key={u.id}
                            value={u.name}
                            onSelect={() => {
                              setFormUserId(u.id.toString());
                              setUserComboOpen(false);
                            }}
                          >
                            <Check className={`mr-2 h-4 w-4 ${formUserId === u.id.toString() ? "opacity-100" : "opacity-0"}`} />
                            {u.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Récurrence</Label>
              <Select value={formRecurrence} onValueChange={v => { setFormRecurrence(v as RecurrenceType); setFormDays([]); }}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Quotidien (chaque jour)</SelectItem>
                  <SelectItem value="weekly">Hebdomadaire (un jour fixe)</SelectItem>
                  <SelectItem value="specific_days">Jours spécifiques de la semaine</SelectItem>
                </SelectContent>
              </Select>
              {formRecurrence !== "daily" && (
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground mb-1">
                    {formRecurrence === "weekly" ? "Choisir le jour :" : "Choisir les jours :"}
                  </p>
                  <DaysPicker
                    selected={formDays}
                    onChange={days => {
                      if (formRecurrence === "weekly") {
                        setFormDays(days.length > 0 ? [days[days.length - 1]] : []);
                      } else {
                        setFormDays(days);
                      }
                    }}
                  />
                </div>
              )}
            </div>
            <div>
              <Label>Ordre</Label>
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
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
            <Button onClick={save} disabled={saving || !formTitle.trim() || !formUserId}>
              {saving ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
