import { useState, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertTriangle, AlertCircle, Info, Bell, BellOff,
  CheckCheck, Package, RotateCcw, CreditCard, Factory, TrendingDown,
  ChevronRight, ClipboardList,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { useLocation } from "wouter";

// ─── Types ────────────────────────────────────────────────────────────────────
interface EAlert {
  id: number;
  alertKey: string;
  type: string;
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  module: string;
  branchId: number | null;
  entityId: number | null;
  entityType: string | null;
  meta: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
}

interface UserNotif {
  id: number;
  userId: number;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────
const MODULE_LABELS: Record<string, string> = {
  stock: "Stock",
  returns: "Retours",
  sales: "Ventes",
  contacts: "Clients",
  production: "Production",
  analytics: "Analytique Ventes",
};

const TYPE_ICON: Record<string, React.ElementType> = {
  stock_low: Package,
  return_pending: RotateCcw,
  refund_pending: RotateCcw,
  credit_limit_exceeded: CreditCard,
  production_blocked: Factory,
  receivable_overdue: TrendingDown,
};

const MODULE_ROUTES: Record<string, string> = {
  stock: "/stock",
  returns: "/returns",
  sales: "/sales",
  contacts: "/contacts",
  production: "/production",
  analytics: "/analytics/sales",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "critical") return <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />;
  if (severity === "warning") return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
  return <Info className="h-4 w-4 text-blue-500 shrink-0" />;
}

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === "critical") return <Badge className="text-[10px] h-4 px-1.5 bg-red-100 text-red-700 border-red-200">Critique</Badge>;
  if (severity === "warning") return <Badge className="text-[10px] h-4 px-1.5 bg-amber-100 text-amber-700 border-amber-200">Avertissement</Badge>;
  return <Badge className="text-[10px] h-4 px-1.5 bg-blue-100 text-blue-700 border-blue-200">Info</Badge>;
}

function AlertCard({ alert, onRead, onNavigate }: {
  alert: EAlert;
  onRead: (id: number) => void;
  onNavigate: (module: string) => void;
}) {
  const Icon = TYPE_ICON[alert.type] ?? Bell;
  const age = formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true, locale: fr });

  return (
    <div
      className={`group relative flex gap-3 p-3 rounded-lg border transition-all ${
        alert.isRead
          ? "border-border/50 bg-background opacity-60"
          : alert.severity === "critical"
          ? "border-red-200 bg-red-50/40"
          : alert.severity === "warning"
          ? "border-amber-200 bg-amber-50/30"
          : "border-blue-200 bg-blue-50/30"
      }`}
    >
      {!alert.isRead && (
        <span className={`absolute top-3 right-3 h-2 w-2 rounded-full ${
          alert.severity === "critical" ? "bg-red-500" : alert.severity === "warning" ? "bg-amber-500" : "bg-blue-500"
        }`} />
      )}

      <div className={`mt-0.5 p-1.5 rounded-md shrink-0 ${
        alert.severity === "critical" ? "bg-red-100" : alert.severity === "warning" ? "bg-amber-100" : "bg-blue-100"
      }`}>
        <Icon className={`h-3.5 w-3.5 ${
          alert.severity === "critical" ? "text-red-600" : alert.severity === "warning" ? "text-amber-600" : "text-blue-600"
        }`} />
      </div>

      <div
        className="flex-1 min-w-0 space-y-1 cursor-pointer"
        onClick={() => { if (!alert.isRead) onRead(alert.id); }}
        title={alert.isRead ? "Lue" : "Cliquer pour marquer comme lue"}
      >
        <p className={`text-sm font-semibold leading-tight ${alert.isRead ? "text-muted-foreground" : "text-foreground"}`}>
          {alert.title}
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{alert.message}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <SeverityBadge severity={alert.severity} />
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
            {MODULE_LABELS[alert.module] ?? alert.module}
          </span>
          <span className="text-[10px] text-muted-foreground ml-auto">{age}</span>
        </div>
      </div>

      <button
        className="shrink-0 mt-0.5 h-6 w-6 flex items-center justify-center rounded-md hover:bg-muted transition-colors opacity-0 group-hover:opacity-100"
        onClick={() => { if (!alert.isRead) onRead(alert.id); onNavigate(alert.module); }}
        title={`Ouvrir ${MODULE_LABELS[alert.module] ?? alert.module}`}
      >
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </div>
  );
}

function UserNotifCard({ notif, onRead, onNavigate }: {
  notif: UserNotif;
  onRead: (id: number) => void;
  onNavigate?: () => void;
}) {
  const age = formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true, locale: fr });

  return (
    <div
      className={`group relative flex gap-3 p-3 rounded-lg border transition-all cursor-pointer ${
        notif.isRead
          ? "border-border/50 bg-background opacity-60"
          : "border-primary/30 bg-primary/5"
      }`}
      onClick={() => { if (!notif.isRead) onRead(notif.id); }}
      title={notif.isRead ? "Lu" : "Cliquer pour marquer comme lu"}
    >
      {!notif.isRead && (
        <span className="absolute top-3 left-3 h-2 w-2 rounded-full bg-primary" />
      )}

      <div className={`mt-0.5 p-1.5 rounded-md shrink-0 ${notif.isRead ? "bg-muted" : "bg-primary/10"}`}>
        <ClipboardList className={`h-3.5 w-3.5 ${notif.isRead ? "text-muted-foreground" : "text-primary"}`} />
      </div>

      <div className="flex-1 min-w-0 space-y-1">
        <p className={`text-sm font-semibold leading-tight ${notif.isRead ? "text-muted-foreground" : "text-foreground"}`}>
          {notif.title}
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{notif.message}</p>
        <span className="text-[10px] text-muted-foreground">{age}</span>
      </div>

      {onNavigate && (
        <button
          className="shrink-0 mt-0.5 h-6 w-6 flex items-center justify-center rounded-md hover:bg-muted transition-colors opacity-0 group-hover:opacity-100"
          onClick={e => { e.stopPropagation(); if (!notif.isRead) onRead(notif.id); onNavigate(); }}
          title="Ouvrir Analytique Ventes → Alertes"
        >
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface NotificationsDrawerProps {
  open: boolean;
  onClose: () => void;
}

type Tab = "alerts" | "personal";

export function NotificationsDrawer({ open, onClose }: NotificationsDrawerProps) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>("personal");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [filterModule, setFilterModule] = useState<string>("all");
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  const token = () => localStorage.getItem("erp_token") ?? "";

  const { data: alerts = [], isLoading: alertsLoading, refetch: refetchAlerts } = useQuery<EAlert[]>({
    queryKey: ["notifications", filterSeverity, filterModule, showUnreadOnly],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterSeverity !== "all") params.set("severity", filterSeverity);
      if (filterModule !== "all") params.set("module", filterModule);
      if (showUnreadOnly) params.set("unread", "true");
      const r = await fetch(`/api/notifications?${params}`, { headers: { Authorization: `Bearer ${token()}` } });
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: open && activeTab === "alerts",
    refetchInterval: open && activeTab === "alerts" ? 30_000 : false,
  });

  const { data: userNotifs = [], isLoading: userNotifsLoading, refetch: refetchUserNotifs } = useQuery<UserNotif[]>({
    queryKey: ["notifications-user"],
    queryFn: async () => {
      const r = await fetch("/api/notifications/user", { headers: { Authorization: `Bearer ${token()}` } });
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: open,
    refetchInterval: open ? 30_000 : false,
  });

  const readMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/notifications/${id}/read`, { method: "POST", headers: { Authorization: `Bearer ${token()}` } });
    },
    onSuccess: () => { refetchAlerts(); qc.invalidateQueries({ queryKey: ["notifications-badge"] }); },
  });

  const readAllMutation = useMutation({
    mutationFn: async () => {
      await fetch("/api/notifications/read-all", { method: "POST", headers: { Authorization: `Bearer ${token()}` } });
    },
    onSuccess: () => { refetchAlerts(); qc.invalidateQueries({ queryKey: ["notifications-badge"] }); },
  });

  const readUserNotifMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/notifications/user/${id}/read`, { method: "POST", headers: { Authorization: `Bearer ${token()}` } });
    },
    onSuccess: () => { refetchUserNotifs(); qc.invalidateQueries({ queryKey: ["notifications-badge"] }); },
  });

  const readAllUserNotifsMutation = useMutation({
    mutationFn: async () => {
      await fetch("/api/notifications/user/read-all", { method: "POST", headers: { Authorization: `Bearer ${token()}` } });
    },
    onSuccess: () => { refetchUserNotifs(); qc.invalidateQueries({ queryKey: ["notifications-badge"] }); },
  });

  const handleNavigate = useCallback((module: string) => {
    const route = MODULE_ROUTES[module];
    if (route) { navigate(route); onClose(); }
  }, [navigate, onClose]);

  const unreadAlerts = alerts.filter(a => !a.isRead).length;
  const criticalCount = alerts.filter(a => a.severity === "critical" && !a.isRead).length;
  const unreadUserNotifs = userNotifs.filter(n => !n.isRead).length;

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:w-[440px] p-0 flex flex-col">
        <SheetHeader className="px-4 py-4 border-b shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Notifications
            </SheetTitle>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-2 bg-muted rounded-lg p-1">
            <button
              onClick={() => setActiveTab("personal")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-all ${
                activeTab === "personal"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <ClipboardList className="h-3.5 w-3.5" />
              Mes notifications
              {unreadUserNotifs > 0 && (
                <span className="h-4 min-w-4 px-1 flex items-center justify-center rounded-full text-[9px] font-bold bg-primary text-primary-foreground">
                  {unreadUserNotifs}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("alerts")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-all ${
                activeTab === "alerts"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Alertes système
              {unreadAlerts > 0 && (
                <span className={`h-4 min-w-4 px-1 flex items-center justify-center rounded-full text-[9px] font-bold text-white ${
                  criticalCount > 0 ? "bg-red-500" : "bg-amber-500"
                }`}>
                  {unreadAlerts}
                </span>
              )}
            </button>
          </div>
        </SheetHeader>

        {/* Personal notifications tab */}
        {activeTab === "personal" && (
          <>
            {unreadUserNotifs > 0 && (
              <div className="px-4 py-2 border-b shrink-0 flex justify-end">
                <Button variant="ghost" size="sm" className="text-xs h-7 gap-1" onClick={() => readAllUserNotifsMutation.mutate()}>
                  <CheckCheck className="h-3.5 w-3.5" />Tout marquer comme lu
                </Button>
              </div>
            )}
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-2">
                {userNotifsLoading ? (
                  <div className="py-12 text-center text-muted-foreground text-sm">Chargement…</div>
                ) : userNotifs.length === 0 ? (
                  <div className="py-16 text-center space-y-2">
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto">
                      <Bell className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">Aucune notification</p>
                    <p className="text-xs text-muted-foreground">Les notifications de tâches qui vous sont assignées apparaîtront ici.</p>
                  </div>
                ) : (
                  userNotifs.map(n => (
                    <UserNotifCard
                      key={n.id}
                      notif={n}
                      onRead={id => readUserNotifMutation.mutate(id)}
                      onNavigate={n.meta?.link ? () => { navigate(n.meta!.link as string); onClose(); } : undefined}
                    />
                  ))
                )}
              </div>
            </ScrollArea>
          </>
        )}

        {/* Operational alerts tab */}
        {activeTab === "alerts" && (
          <>
            {unreadAlerts > 0 && (
              <div className="px-4 py-2 border-b shrink-0 flex justify-between items-center">
                <div className="flex gap-2">
                  {criticalCount > 0 && (
                    <div className="flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 px-2 py-1 rounded-lg">
                      <AlertCircle className="h-3 w-3" />{criticalCount} critique{criticalCount > 1 ? "s" : ""}
                    </div>
                  )}
                  {alerts.filter(a => a.severity === "warning" && !a.isRead).length > 0 && (
                    <div className="flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
                      <AlertTriangle className="h-3 w-3" />{alerts.filter(a => a.severity === "warning" && !a.isRead).length} avertissement{alerts.filter(a => a.severity === "warning" && !a.isRead).length > 1 ? "s" : ""}
                    </div>
                  )}
                </div>
                <Button variant="ghost" size="sm" className="text-xs h-7 gap-1" onClick={() => readAllMutation.mutate()}>
                  <CheckCheck className="h-3.5 w-3.5" />Tout lire
                </Button>
              </div>
            )}

            {/* Filters */}
            <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0 bg-muted/20">
              <Select value={filterSeverity} onValueChange={setFilterSeverity}>
                <SelectTrigger className="h-7 text-xs flex-1">
                  <SelectValue placeholder="Sévérité" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes sévérités</SelectItem>
                  <SelectItem value="critical">Critique</SelectItem>
                  <SelectItem value="warning">Avertissement</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterModule} onValueChange={setFilterModule}>
                <SelectTrigger className="h-7 text-xs flex-1">
                  <SelectValue placeholder="Module" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous modules</SelectItem>
                  {Object.entries(MODULE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant={showUnreadOnly ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs px-2 shrink-0"
                onClick={() => setShowUnreadOnly(!showUnreadOnly)}
              >
                {showUnreadOnly ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
              </Button>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-3 space-y-2">
                {alertsLoading ? (
                  <div className="py-12 text-center text-muted-foreground text-sm">Chargement…</div>
                ) : alerts.length === 0 ? (
                  <div className="py-16 text-center space-y-2">
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto">
                      <Bell className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">Aucune alerte active</p>
                    <p className="text-xs text-muted-foreground">Le système surveille vos opérations en continu.</p>
                  </div>
                ) : (
                  <>
                    {alerts.filter(a => a.severity === "critical").length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-red-600 px-1">Critiques</p>
                        {alerts.filter(a => a.severity === "critical").map(a => (
                          <AlertCard key={a.id} alert={a} onRead={id => readMutation.mutate(id)} onNavigate={handleNavigate} />
                        ))}
                      </div>
                    )}
                    {alerts.filter(a => a.severity === "warning").length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 px-1">Avertissements</p>
                        {alerts.filter(a => a.severity === "warning").map(a => (
                          <AlertCard key={a.id} alert={a} onRead={id => readMutation.mutate(id)} onNavigate={handleNavigate} />
                        ))}
                      </div>
                    )}
                    {alerts.filter(a => a.severity === "info").length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600 px-1">Informations</p>
                        {alerts.filter(a => a.severity === "info").map(a => (
                          <AlertCard key={a.id} alert={a} onRead={id => readMutation.mutate(id)} onNavigate={handleNavigate} />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </ScrollArea>
          </>
        )}

        <div className="px-4 py-3 border-t shrink-0 bg-muted/20">
          <p className="text-[10px] text-muted-foreground text-center">
            {activeTab === "personal"
              ? "Notifications personnelles — tâches qui vous sont assignées"
              : "Alertes générées en temps réel à partir des données du système"}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
