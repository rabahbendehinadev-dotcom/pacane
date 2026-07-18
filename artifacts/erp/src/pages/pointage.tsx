import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import {
  Users, UserCheck, UserX, Clock, Plus, Edit2, Trash2,
  Monitor, Smartphone, QrCode, AlertTriangle, RefreshCw, Download,
  Copy, ExternalLink, RotateCcw
} from "lucide-react";

const API = (path: string, opts?: RequestInit) =>
  fetch(`/api${path}`, { ...opts, headers: { Authorization: `Bearer ${localStorage.getItem("erp_token")}`, "Content-Type": "application/json", ...(opts?.headers ?? {}) } });

function statusBadge(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    present:            { label: "Présent",          cls: "bg-green-100 text-green-700 border-green-200" },
    late:               { label: "En retard",        cls: "bg-orange-100 text-orange-700 border-orange-200" },
    absent:             { label: "Absent",            cls: "bg-red-100 text-red-700 border-red-200" },
    left:               { label: "Sorti",             cls: "bg-blue-100 text-blue-700 border-blue-200" },
    early_leave:        { label: "Sortie anticipée", cls: "bg-amber-100 text-amber-700 border-amber-200" },
    overtime:           { label: "Heures supp.",     cls: "bg-blue-100 text-blue-800 border-blue-200" },
    suspicious:         { label: "Suspect",           cls: "bg-red-900/20 text-red-900 border-red-300" },
    corrected:          { label: "Corrigé",           cls: "bg-purple-100 text-purple-700 border-purple-200" },
    pending_validation: { label: "En attente",        cls: "bg-gray-100 text-gray-600 border-gray-200" },
  };
  const s = map[status] ?? { label: status, cls: "bg-gray-100 text-gray-600" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${s.cls}`}>{s.label}</span>;
}

function fmtTime(ts: string | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("fr-DZ", { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(ts: string | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("fr-DZ", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtMinutes(min: number | null | undefined) {
  if (!min) return "—";
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? `${h}h${m > 0 ? String(m).padStart(2, "0") : ""}` : `${m}min`;
}

// ── TODAY TAB ────────────────────────────────────────────────────────────────
function TodayTab({ branches }: { branches: any[] }) {
  const [branchId, setBranchId] = useState("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["attendance-today", branchId],
    queryFn: async () => {
      const r = await API(`/attendance/today${branchId ? `?branchId=${branchId}` : ""}`);
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const summary = data?.summary ?? { total: 0, present: 0, left: 0, absent: 0, late: 0 };
  const employees: any[] = data?.employees ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={branchId || "all"} onValueChange={v => setBranchId(v === "all" ? "" : v)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Toutes les boutiques" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les boutiques</SelectItem>
            {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" /> Actualiser
        </Button>
        <span className="text-sm text-muted-foreground ml-auto">
          {data?.date ? new Date(data.date).toLocaleDateString("fr-DZ", { weekday: "long", day: "numeric", month: "long" }) : ""}
        </span>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total", value: summary.total, icon: Users, cls: "text-gray-700" },
          { label: "Présents", value: summary.present, icon: UserCheck, cls: "text-green-600" },
          { label: "Sortis", value: summary.left, icon: UserCheck, cls: "text-blue-600" },
          { label: "Absents", value: summary.absent, icon: UserX, cls: "text-red-600" },
          { label: "En retard", value: summary.late, icon: Clock, cls: "text-orange-600" },
        ].map(({ label, value, icon: Icon, cls }) => (
          <Card key={label} className="text-center">
            <CardContent className="py-3 px-4">
              <Icon className={`h-5 w-5 mx-auto mb-1 ${cls}`} />
              <div className={`text-2xl font-bold ${cls}`}>{value}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Employees table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employé</TableHead>
                <TableHead>Horaire</TableHead>
                <TableHead>Première entrée</TableHead>
                <TableHead>Dernière sortie</TableHead>
                <TableHead>Travaillé</TableHead>
                <TableHead>Retard</TableHead>
                <TableHead>Statut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Chargement...</TableCell></TableRow>
              ) : employees.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Aucun employé avec pointage activé</TableCell></TableRow>
              ) : employees.map(e => (
                <TableRow key={e.userId}>
                  <TableCell className="font-medium text-sm">{e.userName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.workStartTime} – {e.workEndTime}</TableCell>
                  <TableCell className="text-sm">
                    {e.firstIn ? (
                      <span className={e.firstIn.lateMinutes > 0 ? "text-orange-600" : "text-green-600"}>
                        {fmtTime(e.firstIn.timestamp)}
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{fmtTime(e.lastOut?.timestamp)}</TableCell>
                  <TableCell className="text-sm">{fmtMinutes(e.workedMinutes)}</TableCell>
                  <TableCell className="text-sm">
                    {e.lateMinutes > 0 ? <span className="text-orange-600">{fmtMinutes(e.lateMinutes)}</span> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>{statusBadge(e.dayStatus === "left" ? "left" : e.lateMinutes > 0 ? "late" : e.dayStatus)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── RECORDS TAB ──────────────────────────────────────────────────────────────
function RecordsTab({ branches, users }: { branches: any[]; users: any[] }) {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ userId: "", branchId: "", dateFrom: "", dateTo: "", status: "" });
  const [editRecord, setEditRecord] = useState<any>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ userId: "", branchId: "", type: "IN", timestamp: "", notes: "", reason: "" });
  const [editForm, setEditForm] = useState({ timestamp: "", status: "", notes: "", reason: "" });

  const params = new URLSearchParams();
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.branchId) params.set("branchId", filters.branchId);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.status) params.set("status", filters.status);

  const { data: records = [], isLoading } = useQuery({
    queryKey: ["attendance-records", filters],
    queryFn: async () => {
      const r = await API(`/attendance/records?${params}&limit=200`);
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
  });

  const addMutation = useMutation({
    mutationFn: async (d: any) => { const r = await API("/attendance/records", { method: "POST", body: JSON.stringify(d) }); if (!r.ok) { const e = await r.json(); throw new Error(e.error); } return r.json(); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["attendance-records"] }); setAddOpen(false); toast({ title: "Pointage ajouté" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, d }: { id: number; d: any }) => { const r = await API(`/attendance/records/${id}`, { method: "PATCH", body: JSON.stringify(d) }); if (!r.ok) { const e = await r.json(); throw new Error(e.error); } return r.json(); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["attendance-records"] }); setEditRecord(null); toast({ title: "Pointage corrigé" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => { const r = await API(`/attendance/records/${id}`, { method: "DELETE", body: JSON.stringify({ reason }) }); if (!r.ok) throw new Error("Erreur"); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["attendance-records"] }); toast({ title: "Pointage supprimé" }); },
  });

  function openEdit(rec: any) {
    setEditRecord(rec);
    setEditForm({ timestamp: rec.timestamp?.slice(0, 16) ?? "", status: rec.status, notes: rec.notes ?? "", reason: "" });
  }

  const f = filters;
  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <Label className="text-xs mb-1 block">Employé</Label>
          <Select value={f.userId || "all"} onValueChange={v => setFilters(p => ({ ...p, userId: v === "all" ? "" : v }))}>
            <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="Tous" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous</SelectItem>
              {users.filter(u => u.pointageEnabled).map(u => <SelectItem key={u.userId} value={String(u.userId)}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs mb-1 block">Boutique</Label>
          <Select value={f.branchId || "all"} onValueChange={v => setFilters(p => ({ ...p, branchId: v === "all" ? "" : v }))}>
            <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="Toutes" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes</SelectItem>
              {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs mb-1 block">Du</Label>
          <Input type="date" className="h-8 text-xs w-36" value={f.dateFrom} onChange={e => setFilters(p => ({ ...p, dateFrom: e.target.value }))} />
        </div>
        <div>
          <Label className="text-xs mb-1 block">Au</Label>
          <Input type="date" className="h-8 text-xs w-36" value={f.dateTo} onChange={e => setFilters(p => ({ ...p, dateTo: e.target.value }))} />
        </div>
        <div>
          <Label className="text-xs mb-1 block">Statut</Label>
          <Select value={f.status || "all"} onValueChange={v => setFilters(p => ({ ...p, status: v === "all" ? "" : v }))}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Tous" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous</SelectItem>
              {["present","late","early_leave","overtime","suspicious","corrected"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" className="h-8 gap-1 ml-auto" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Ajouter
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employé</TableHead>
                <TableHead>Boutique</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Date & Heure</TableHead>
                <TableHead>Retard</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Chargement...</TableCell></TableRow>
              ) : (records as any[]).length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Aucun enregistrement</TableCell></TableRow>
              ) : (records as any[]).map((rec: any) => (
                <TableRow key={rec.id} className={rec.isSuspicious ? "bg-red-50" : ""}>
                  <TableCell className="text-sm font-medium">{rec.userName ?? `User ${rec.userId}`}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{rec.branchName ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={rec.type === "IN" ? "default" : "secondary"} className="text-xs">
                      {rec.type === "IN" ? "Entrée" : "Sortie"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{fmtDate(rec.timestamp)} {fmtTime(rec.timestamp)}</TableCell>
                  <TableCell className="text-sm">
                    {rec.lateMinutes > 0 ? <span className="text-orange-600">{fmtMinutes(rec.lateMinutes)}</span> : "—"}
                  </TableCell>
                  <TableCell>{statusBadge(rec.status)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(rec)}><Edit2 className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:bg-red-50"
                        onClick={() => { const r = prompt("Raison de la suppression ?"); if (r) deleteMutation.mutate({ id: rec.id, reason: r }); }}>
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

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Ajouter un pointage manuel</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Employé *</Label>
              <Select value={addForm.userId} onValueChange={v => setAddForm(f => ({ ...f, userId: v }))}>
                <SelectTrigger><SelectValue placeholder="Choisir..." /></SelectTrigger>
                <SelectContent>{users.map(u => <SelectItem key={u.userId} value={String(u.userId)}>{u.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Boutique *</Label>
              <Select value={addForm.branchId} onValueChange={v => setAddForm(f => ({ ...f, branchId: v }))}>
                <SelectTrigger><SelectValue placeholder="Choisir..." /></SelectTrigger>
                <SelectContent>{branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type *</Label>
                <Select value={addForm.type} onValueChange={v => setAddForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="IN">Entrée</SelectItem><SelectItem value="OUT">Sortie</SelectItem></SelectContent>
                </Select>
              </div>
              <div>
                <Label>Date & Heure *</Label>
                <Input type="datetime-local" value={addForm.timestamp} onChange={e => setAddForm(f => ({ ...f, timestamp: e.target.value }))} />
              </div>
            </div>
            <div><Label>Raison</Label><Input value={addForm.reason} onChange={e => setAddForm(f => ({ ...f, reason: e.target.value }))} /></div>
            <div><Label>Notes</Label><Input value={addForm.notes} onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Annuler</Button>
            <Button onClick={() => addMutation.mutate(addForm)} disabled={!addForm.userId || !addForm.branchId || !addForm.timestamp || addMutation.isPending}>
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editRecord} onOpenChange={o => { if (!o) setEditRecord(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Corriger le pointage</DialogTitle></DialogHeader>
          {editRecord && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Employé : <strong>{editRecord.userName}</strong> — {editRecord.type === "IN" ? "Entrée" : "Sortie"}</p>
              <div><Label>Nouvelle date & heure</Label><Input type="datetime-local" value={editForm.timestamp} onChange={e => setEditForm(f => ({ ...f, timestamp: e.target.value }))} /></div>
              <div>
                <Label>Nouveau statut</Label>
                <Select value={editForm.status} onValueChange={v => setEditForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["present","late","early_leave","overtime","suspicious","corrected","pending_validation"].map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Raison de la correction *</Label><Input value={editForm.reason} onChange={e => setEditForm(f => ({ ...f, reason: e.target.value }))} /></div>
              <div><Label>Notes</Label><Input value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRecord(null)}>Annuler</Button>
            <Button onClick={() => editMutation.mutate({ id: editRecord.id, d: editForm })} disabled={!editForm.reason || editMutation.isPending}>
              Corriger
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── EMPLOYEES TAB ────────────────────────────────────────────────────────────
function EmployeesTab({ branches, users, refetchUsers }: { branches: any[]; users: any[]; refetchUsers: () => void }) {
  const qc = useQueryClient();
  const [settingsUser, setSettingsUser] = useState<any>(null);
  const [form, setForm] = useState<any>({});

  const { data: settingsDetail } = useQuery({
    queryKey: ["attendance-settings", settingsUser?.userId],
    queryFn: async () => { const r = await API(`/attendance/settings/${settingsUser.userId}`); return r.json(); },
    enabled: !!settingsUser,
  });

  const saveMutation = useMutation({
    mutationFn: async (d: any) => { const r = await API(`/attendance/settings/${settingsUser.userId}`, { method: "PUT", body: JSON.stringify(d) }); if (!r.ok) { const e = await r.json(); throw new Error(e.error); } return r.json(); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["attendance-users"] }); qc.invalidateQueries({ queryKey: ["attendance-settings"] }); refetchUsers(); setSettingsUser(null); toast({ title: "Paramètres enregistrés" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const resetDeviceMutation = useMutation({
    mutationFn: async ({ uid, reason }: { uid: number; reason: string }) => { const r = await API(`/attendance/devices/mobile/reset/${uid}`, { method: "POST", body: JSON.stringify({ reason }) }); if (!r.ok) throw new Error("Erreur"); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["attendance-settings"] }); refetchUsers(); toast({ title: "Appareil réinitialisé" }); },
  });

  function openSettings(u: any) {
    setSettingsUser(u);
    setForm({
      branchId: u.branchId ?? "",
      pointageEnabled: u.pointageEnabled ?? false,
      workStartTime: u.workStartTime ?? "08:00",
      workEndTime: u.workEndTime ?? "17:00",
      workDays: u.workDays ?? ["lun","mar","mer","jeu","ven"],
      gracePeriodMinutes: u.gracePeriodMinutes ?? 10,
      baseSalary: u.baseSalary ?? "0",
      salaryType: u.salaryType ?? "monthly",
      lateDeductionType: u.lateDeductionType ?? "per_minute",
      lateDeductionValue: u.lateDeductionValue ?? "0",
      absenceDeductionValue: u.absenceDeductionValue ?? "0",
      earlyLeaveDeductionValue: u.earlyLeaveDeductionValue ?? "0",
      overtimeRateMultiplier: u.overtimeRateMultiplier ?? "1.5",
      autoDeductions: u.autoDeductions ?? false,
      adminNotes: u.adminNotes ?? "",
    });
  }

  const deviceStatusMap: Record<string, { label: string; cls: string }> = {
    none:    { label: "Aucun",      cls: "bg-gray-100 text-gray-600" },
    pending: { label: "En attente", cls: "bg-yellow-100 text-yellow-700" },
    approved:{ label: "Approuvé",   cls: "bg-green-100 text-green-700" },
    rejected:{ label: "Rejeté",     cls: "bg-red-100 text-red-700" },
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Tous les utilisateurs — activez le pointage et configurez leurs paramètres.</p>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Boutique</TableHead>
                <TableHead>Pointage</TableHead>
                <TableHead>Horaire</TableHead>
                <TableHead>Salaire</TableHead>
                <TableHead>Appareil</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u: any) => {
                const devStatus = deviceStatusMap[u.mobileDeviceStatus ?? "none"];
                return (
                  <TableRow key={u.userId}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{u.name}</p>
                        <p className="text-xs text-muted-foreground">@{u.username}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{u.branchName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${u.pointageEnabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {u.pointageEnabled ? "Activé" : "Désactivé"}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{u.workStartTime ?? "—"} – {u.workEndTime ?? "—"}</TableCell>
                    <TableCell className="text-sm">{u.baseSalary ? `${Number(u.baseSalary).toLocaleString("fr-DZ")} DA` : "—"}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${devStatus.cls}`}>{devStatus.label}</span>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openSettings(u)}>
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Settings dialog */}
      <Dialog open={!!settingsUser} onOpenChange={o => { if (!o) setSettingsUser(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Paramètres de pointage — {settingsUser?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Activation + Branch */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Pointage activé</Label>
                <Select value={form.pointageEnabled ? "true" : "false"} onValueChange={v => setForm((f: any) => ({ ...f, pointageEnabled: v === "true" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="true">Oui</SelectItem><SelectItem value="false">Non</SelectItem></SelectContent>
                </Select>
              </div>
              <div>
                <Label>Boutique</Label>
                <Select value={form.branchId ? String(form.branchId) : "none"} onValueChange={v => setForm((f: any) => ({ ...f, branchId: v === "none" ? null : parseInt(v) }))}>
                  <SelectTrigger><SelectValue placeholder="Aucune" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Aucune</SelectItem>
                    {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Schedule */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Heure début</Label>
                <Input type="time" value={form.workStartTime} onChange={e => setForm((f: any) => ({ ...f, workStartTime: e.target.value }))} />
              </div>
              <div>
                <Label>Heure fin</Label>
                <Input type="time" value={form.workEndTime} onChange={e => setForm((f: any) => ({ ...f, workEndTime: e.target.value }))} />
              </div>
              <div>
                <Label>Tolérance (min)</Label>
                <Input type="number" value={form.gracePeriodMinutes} onChange={e => setForm((f: any) => ({ ...f, gracePeriodMinutes: parseInt(e.target.value) || 0 }))} />
              </div>
            </div>

            {/* Salary */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Salaire de base (DA)</Label>
                <Input type="number" value={form.baseSalary} onChange={e => setForm((f: any) => ({ ...f, baseSalary: e.target.value }))} />
              </div>
              <div>
                <Label>Type de salaire</Label>
                <Select value={form.salaryType} onValueChange={v => setForm((f: any) => ({ ...f, salaryType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Mensuel</SelectItem>
                    <SelectItem value="daily">Journalier</SelectItem>
                    <SelectItem value="hourly">Horaire</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Deductions */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type retard</Label>
                <Select value={form.lateDeductionType} onValueChange={v => setForm((f: any) => ({ ...f, lateDeductionType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Montant fixe</SelectItem>
                    <SelectItem value="per_minute">Par minute</SelectItem>
                    <SelectItem value="per_hour">Par heure</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Valeur retard (DA)</Label>
                <Input type="number" value={form.lateDeductionValue} onChange={e => setForm((f: any) => ({ ...f, lateDeductionValue: e.target.value }))} />
              </div>
              <div>
                <Label>Retenue absence (DA/j)</Label>
                <Input type="number" value={form.absenceDeductionValue} onChange={e => setForm((f: any) => ({ ...f, absenceDeductionValue: e.target.value }))} />
              </div>
              <div>
                <Label>Sortie anticipée (DA)</Label>
                <Input type="number" value={form.earlyLeaveDeductionValue} onChange={e => setForm((f: any) => ({ ...f, earlyLeaveDeductionValue: e.target.value }))} />
              </div>
            </div>

            {/* Overtime */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Multiplicateur heures supp.</Label>
                <Input type="number" step="0.1" value={form.overtimeRateMultiplier} onChange={e => setForm((f: any) => ({ ...f, overtimeRateMultiplier: e.target.value }))} />
              </div>
              <div>
                <Label>Déductions auto.</Label>
                <Select value={form.autoDeductions ? "true" : "false"} onValueChange={v => setForm((f: any) => ({ ...f, autoDeductions: v === "true" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="true">Oui</SelectItem><SelectItem value="false">Non</SelectItem></SelectContent>
                </Select>
              </div>
            </div>

            {/* Notes */}
            <div>
              <Label>Notes administratives</Label>
              <Input value={form.adminNotes} onChange={e => setForm((f: any) => ({ ...f, adminNotes: e.target.value }))} />
            </div>

            {/* Device info */}
            {settingsDetail?.settings && (
              <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Appareil mobile</p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm">Statut : <span className="font-medium">{settingsDetail.settings.mobileDeviceStatus}</span></p>
                    {settingsDetail.mobileDevice && <p className="text-xs text-muted-foreground">{settingsDetail.mobileDevice.deviceName ?? settingsDetail.mobileDevice.deviceId?.slice(0, 16)}</p>}
                  </div>
                  {settingsDetail.settings.mobileDeviceStatus !== "none" && (
                    <Button variant="destructive" size="sm" onClick={() => { const r = prompt("Raison du reset ?"); if (r) resetDeviceMutation.mutate({ uid: settingsUser.userId, reason: r }); }}>
                      Reset Mobile
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsUser(null)}>Annuler</Button>
            <Button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── DEVICES TAB ──────────────────────────────────────────────────────────────
function DevicesTab({ branches }: { branches: any[] }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [createdKiosk, setCreatedKiosk] = useState<{ slug: string; deviceName: string } | null>(null);
  const [newDevice, setNewDevice] = useState({ branchId: "", deviceName: "", kioskSlug: "" });
  const [regenSlugId, setRegenSlugId] = useState<number | null>(null);
  const [regenSlugVal, setRegenSlugVal] = useState("");

  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
  const kioskUrl = (slug: string) => `${window.location.origin}${BASE}/kiosk/${slug}`;

  const { data: desktops = [], refetch: refetchDesktops } = useQuery({
    queryKey: ["desktop-devices"],
    queryFn: async () => {
      const r = await API("/attendance/devices/desktop");
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
    refetchInterval: 30_000,
  });

  const { data: mobiles = [] } = useQuery({
    queryKey: ["mobile-devices"],
    queryFn: async () => {
      const r = await API("/attendance/devices/mobile");
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (d: any) => {
      const r = await API("/attendance/devices/desktop", { method: "POST", body: JSON.stringify(d) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error); }
      return r.json();
    },
    onSuccess: (data) => {
      refetchDesktops();
      setCreatedKiosk({ slug: data.kioskSlug, deviceName: data.deviceName });
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      await API(`/attendance/devices/desktop/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) });
    },
    onSuccess: () => refetchDesktops(),
    onError: (e: any) => toast({ title: (e as any).message, variant: "destructive" }),
  });

  const resetDeviceMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await API(`/attendance/devices/desktop/${id}/reset-device`, { method: "POST", body: JSON.stringify({ reason: "Reset by admin" }) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error); }
    },
    onSuccess: () => { refetchDesktops(); toast({ title: "Appareil réinitialisé — prêt pour un nouveau PC" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const regenSlugMutation = useMutation({
    mutationFn: async ({ id, newSlug }: { id: number; newSlug: string }) => {
      const r = await API(`/attendance/devices/desktop/${id}/regenerate-slug`, { method: "POST", body: JSON.stringify({ newSlug }) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error); }
      return r.json();
    },
    onSuccess: () => { refetchDesktops(); setRegenSlugId(null); setRegenSlugVal(""); toast({ title: "Slug régénéré — l'ancien lien ne fonctionnera plus" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const approveMobileMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      await API(`/attendance/devices/mobile/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mobile-devices"] }),
  });

  const onlineStatus = (ts: string | null, isBound: boolean) => {
    if (!isBound) return <span className="text-xs text-muted-foreground italic">Non activé</span>;
    if (!ts) return <span className="text-xs text-muted-foreground">Jamais vu</span>;
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 2 * 60_000) return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />En ligne
      </span>
    );
    if (diff < 30 * 60_000) return <span className="text-xs text-yellow-600">Récent · {fmtTime(ts)}</span>;
    return <span className="text-xs text-muted-foreground">{fmtTime(ts)}</span>;
  };

  return (
    <div className="space-y-6">
      {/* Desktop Kiosks */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2"><Monitor className="h-4 w-4" /> Kiosks QR de boutique</h3>
          <Button size="sm" onClick={() => { setCreatedKiosk(null); setNewDevice({ branchId: "", deviceName: "", kioskSlug: "" }); setAddOpen(true); }} className="gap-1">
            <Plus className="h-3.5 w-3.5" /> Nouveau kiosk
          </Button>
        </div>

        <div className="space-y-3">
          {(desktops as any[]).length === 0 ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">Aucun kiosk créé</CardContent></Card>
          ) : (desktops as any[]).map((d: any) => {
            const url = d.kioskSlug ? kioskUrl(d.kioskSlug) : null;
            const diff = d.lastSeenAt ? Date.now() - new Date(d.lastSeenAt).getTime() : Infinity;
            const isOnline = d.isBound && diff < 2 * 60_000;

            return (
              <Card key={d.id} className={`${!d.isActive ? "opacity-60" : ""}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    {/* Left — identity */}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{d.deviceName}</span>
                        <span className="text-xs text-muted-foreground">{d.branchName ?? "—"}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          !d.isActive ? "bg-gray-100 text-gray-500" :
                          isOnline ? "bg-green-100 text-green-700" :
                          d.isBound ? "bg-blue-100 text-blue-700" : "bg-yellow-100 text-yellow-700"
                        }`}>
                          {!d.isActive ? "Désactivé" : isOnline ? "En ligne" : d.isBound ? "Activé" : "Non activé"}
                        </span>
                      </div>

                      {/* Slug URL */}
                      {url && (
                        <div className="flex items-center gap-2 mt-1">
                          <code className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded truncate max-w-xs">{url}</code>
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1"
                            onClick={() => { navigator.clipboard.writeText(url); toast({ title: "Lien copié !" }); }}>
                            <Copy className="h-3 w-3" /> Copier
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1"
                            onClick={() => window.open(url, "_blank")}>
                            <ExternalLink className="h-3 w-3" /> Ouvrir
                          </Button>
                        </div>
                      )}

                      {/* Device info */}
                      {d.isBound && (
                        <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                          {d.boundDeviceOs && <span>💻 {d.boundDeviceOs}</span>}
                          {d.boundDeviceBrowser && <span>🌐 {d.boundDeviceBrowser}</span>}
                          {d.boundDeviceIp && <span>📡 {d.boundDeviceIp}</span>}
                          <span>🕒 {onlineStatus(d.lastSeenAt, d.isBound)}</span>
                        </div>
                      )}

                      {regenSlugId === d.id && (
                        <div className="flex gap-2 items-center mt-2">
                          <Input
                            className="h-7 text-xs w-48 font-mono uppercase"
                            placeholder="NOUVEAU-SLUG"
                            value={regenSlugVal}
                            onChange={e => setRegenSlugVal(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
                          />
                          <Button size="sm" className="h-7 text-xs" disabled={!regenSlugVal || regenSlugMutation.isPending}
                            onClick={() => regenSlugMutation.mutate({ id: d.id, newSlug: regenSlugVal })}>
                            Confirmer
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setRegenSlugId(null); setRegenSlugVal(""); }}>
                            Annuler
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Right — actions */}
                    <div className="flex flex-col gap-1.5 shrink-0">
                      {d.isBound && (
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-orange-600 border-orange-200 hover:bg-orange-50"
                          onClick={() => { if (confirm("Réinitialiser l'appareil lié ? L'ancien PC devra scanner le QR manuellement.")) resetDeviceMutation.mutate(d.id); }}>
                          <RotateCcw className="h-3 w-3" /> Reset
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                        onClick={() => { setRegenSlugId(d.id); setRegenSlugVal(d.kioskSlug ?? ""); }}>
                        <RefreshCw className="h-3 w-3" /> Nouveau slug
                      </Button>
                      <Button size="sm" variant="outline" className={`h-7 text-xs ${d.isActive ? "text-red-600 border-red-200 hover:bg-red-50" : "text-green-600 border-green-200 hover:bg-green-50"}`}
                        onClick={() => toggleMutation.mutate({ id: d.id, isActive: !d.isActive })}>
                        {d.isActive ? "Désactiver" : "Activer"}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Mobile devices */}
      <div>
        <h3 className="font-semibold flex items-center gap-2 mb-3"><Smartphone className="h-4 w-4" /> Appareils mobiles employés</h3>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employé</TableHead>
                  <TableHead>Appareil</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Vu le</TableHead>
                  <TableHead className="w-32"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(mobiles as any[]).length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Aucune demande d'approbation</TableCell></TableRow>
                ) : (mobiles as any[]).map((m: any) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium text-sm">{m.userName ?? `User ${m.userId}`}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{m.deviceName ?? m.deviceId?.slice(0, 20)}</TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        m.status === "approved" ? "bg-green-100 text-green-700" :
                        m.status === "pending" ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"
                      }`}>{m.status}</span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtTime(m.lastSeenAt)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {m.status === "pending" && (
                          <>
                            <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700" onClick={() => approveMobileMutation.mutate({ id: m.id, status: "approved" })}>Approuver</Button>
                            <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => approveMobileMutation.mutate({ id: m.id, status: "rejected" })}>Rejeter</Button>
                          </>
                        )}
                        {m.status === "approved" && (
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => approveMobileMutation.mutate({ id: m.id, status: "revoked" })}>Révoquer</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Create kiosk dialog */}
      <Dialog open={addOpen} onOpenChange={o => { setAddOpen(o); if (!o) { setCreatedKiosk(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{createdKiosk ? "✅ Kiosk créé" : "Nouveau kiosk QR"}</DialogTitle></DialogHeader>

          {createdKiosk ? (
            <div className="space-y-4">
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm font-medium text-green-800">Kiosk créé avec succès !</p>
                <p className="text-xs text-green-700 mt-0.5">Ouvrez ce lien sur le PC de la boutique pour l'activer automatiquement.</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">Lien du kiosk</Label>
                <div className="flex gap-2">
                  <Input value={kioskUrl(createdKiosk.slug)} readOnly className="text-xs font-mono" />
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(kioskUrl(createdKiosk.slug)); toast({ title: "Lien copié !" }); }}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="flex gap-2">
                <Button className="flex-1 gap-2" onClick={() => window.open(kioskUrl(createdKiosk.slug), "_blank")}>
                  <ExternalLink className="h-4 w-4" /> Ouvrir le kiosk
                </Button>
                <Button variant="outline" onClick={() => { setAddOpen(false); setCreatedKiosk(null); }}>Fermer</Button>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                À la première ouverture, le navigateur sera automatiquement lié à ce kiosk.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label>Boutique *</Label>
                <Select value={newDevice.branchId || "none"} onValueChange={v => {
                  const b = branches.find(x => String(x.id) === v);
                  const slugSugg = b ? b.name.toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9-]/g, "").slice(0, 30) : "";
                  setNewDevice(f => ({ ...f, branchId: v === "none" ? "" : v, kioskSlug: f.kioskSlug || slugSugg }));
                }}>
                  <SelectTrigger><SelectValue placeholder="Choisir une boutique..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Choisir —</SelectItem>
                    {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Nom de l'appareil</Label>
                <Input placeholder="PC Entrée, Kiosk Reception..." value={newDevice.deviceName} onChange={e => setNewDevice(f => ({ ...f, deviceName: e.target.value }))} />
              </div>
              <div>
                <Label>Slug du kiosk *</Label>
                <Input
                  placeholder="BAB-EZZOUAR"
                  className="font-mono uppercase"
                  value={newDevice.kioskSlug}
                  onChange={e => setNewDevice(f => ({ ...f, kioskSlug: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "") }))}
                />
                {newDevice.kioskSlug && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Lien : <code className="text-blue-600">{kioskUrl(newDevice.kioskSlug)}</code>
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">Lettres, chiffres et tirets uniquement. Unique dans le système.</p>
              </div>
            </div>
          )}

          {!createdKiosk && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>Annuler</Button>
              <Button
                onClick={() => createMutation.mutate(newDevice)}
                disabled={!newDevice.branchId || !newDevice.kioskSlug || createMutation.isPending}
              >
                {createMutation.isPending ? "Création..." : "Créer le kiosk"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function PointagePage() {
  const { user } = useAuth();
  const isAdmin = !!(user as any)?.adminAccess;

  const { data: branches = [] } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => {
      const r = await API("/branches");
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
  });

  const { data: users = [], refetch: refetchUsers } = useQuery({
    queryKey: ["attendance-users"],
    queryFn: async () => {
      const r = await API("/attendance/users");
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-serif font-bold">Pointage Employés</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Gestion des présences et absences</p>
      </div>

      <Tabs defaultValue="today">
        <TabsList>
          <TabsTrigger value="today" className="gap-2"><UserCheck className="h-4 w-4" /> Aujourd'hui</TabsTrigger>
          <TabsTrigger value="records" className="gap-2"><Clock className="h-4 w-4" /> Historique</TabsTrigger>
          {isAdmin && <TabsTrigger value="employees" className="gap-2"><Users className="h-4 w-4" /> Employés</TabsTrigger>}
          {isAdmin && <TabsTrigger value="devices" className="gap-2"><QrCode className="h-4 w-4" /> Appareils</TabsTrigger>}
        </TabsList>

        <TabsContent value="today" className="mt-4">
          <TodayTab branches={branches} />
        </TabsContent>

        <TabsContent value="records" className="mt-4">
          <RecordsTab branches={branches} users={users} />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="employees" className="mt-4">
            <EmployeesTab branches={branches} users={users} refetchUsers={refetchUsers} />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="devices" className="mt-4">
            <DevicesTab branches={branches} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
