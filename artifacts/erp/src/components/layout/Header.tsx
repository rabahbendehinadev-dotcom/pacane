import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useLogout, useGetBranches } from "@workspace/api-client-react";
import { Bell, Globe, LogOut, Menu, UserCircle, CheckCircle2, Circle, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useQuery } from "@tanstack/react-query";
import { NotificationsDrawer } from "@/components/notifications/NotificationsDrawer";
import { toast } from "@/hooks/use-toast";

interface ChecklistTask {
  id: number;
  title: string;
  description: string | null;
  isDone: boolean;
}

export function Header({ onMenuClick }: { onMenuClick?: () => void }) {
  const { t, language, setLanguage, isRtl } = useI18n();
  const { user, activeBranchId, setActiveBranchId } = useAuth();
  const logout = useLogout();
  const [notifOpen, setNotifOpen] = useState(false);
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const [checklistTasks, setChecklistTasks] = useState<ChecklistTask[]>([]);
  const [localDone, setLocalDone] = useState<Set<number>>(new Set());
  const [toggling, setToggling] = useState<number | null>(null);
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  const { data: branches = [] } = useGetBranches({
    query: {
      queryKey: ["branches"],
      enabled: !!user,
    }
  });

  const activeBranch = branches.find(b => b.id === activeBranchId);
  const token = () => localStorage.getItem("erp_token") ?? "";

  const { data: badge } = useQuery<{ count: number }>({
    queryKey: ["notifications-badge"],
    queryFn: async () => {
      const r = await fetch("/api/notifications/badge", { headers: { Authorization: `Bearer ${token()}` } });
      if (!r.ok) return { count: 0 };
      return r.json();
    },
    enabled: !!user,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const unreadCount = badge?.count ?? 0;
  const isAdmin = !!(user as any)?.adminAccess;

  const performLogout = () => {
    localStorage.removeItem("erp_token");
    logout.mutate(undefined);
    window.location.href = "/login";
  };

  const handleLogout = async () => {
    if (isAdmin) { performLogout(); return; }
    try {
      const r = await fetch("/api/checklist/my", { headers: { Authorization: `Bearer ${token()}` } });
      if (r.ok) {
        const tasks: ChecklistTask[] = await r.json();
        if (tasks.length > 0) {
          const doneSet = new Set(tasks.filter(t => t.isDone).map(t => t.id));
          setChecklistTasks(tasks);
          setLocalDone(doneSet);
          setLogoutModalOpen(true);
          return;
        }
      }
    } catch {
      // ignore — just logout
    }
    performLogout();
  };

  const toggleTask = async (task: ChecklistTask) => {
    const nowDone = !localDone.has(task.id);
    setToggling(task.id);
    try {
      const action = nowDone ? "complete" : "uncomplete";
      const r = await fetch(`/api/checklist/${task.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
      });
      if (!r.ok) throw new Error();
      setLocalDone(prev => {
        const next = new Set(prev);
        if (nowDone) next.add(task.id); else next.delete(task.id);
        return next;
      });
    } catch {
      toast({ title: "خطأ في التحديث", variant: "destructive" });
    } finally { setToggling(null); }
  };

  const confirmLogout = async () => {
    setConfirmingLogout(true);
    await new Promise(r => setTimeout(r, 200));
    performLogout();
  };

  const toggleLanguage = () => {
    setLanguage(language === "fr" ? "ar" : "fr");
  };

  const doneCount = checklistTasks.filter(t => localDone.has(t.id)).length;

  return (
    <>
      <header
        className="border-b bg-card z-10 shrink-0"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
      <div className="h-16 flex items-center justify-between px-4 lg:px-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={onMenuClick}>
            <Menu className="h-5 w-5" />
          </Button>
          
          {branches.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="hidden sm:flex gap-2">
                  <span className="font-semibold">{activeBranch?.name || "Toutes les boutiques"}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align={isRtl ? "end" : "start"} className="w-[200px]">
                <DropdownMenuLabel>{t("branches")}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setActiveBranchId(null)}
                  className={activeBranchId === null ? "bg-accent font-medium" : ""}
                >
                  Toutes les boutiques
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {branches.map(branch => (
                  <DropdownMenuItem 
                    key={branch.id}
                    onClick={() => setActiveBranchId(branch.id)}
                    className={branch.id === activeBranchId ? "bg-accent" : ""}
                  >
                    {branch.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <Button variant="ghost" size="icon" onClick={toggleLanguage} title={t("language")}>
            <Globe className="h-5 w-5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="relative"
            onClick={() => setNotifOpen(true)}
            title="Alertes opérationnelles"
          >
            <Bell className={`h-5 w-5 transition-colors ${unreadCount > 0 ? "text-amber-600" : ""}`} />
            {unreadCount > 0 && (
              <span className={`absolute top-1.5 right-1.5 h-4 min-w-4 px-0.5 flex items-center justify-center rounded-full text-[9px] font-bold text-white leading-none ${unreadCount > 0 ? (badge?.count ?? 0) > 5 ? "bg-red-500" : "bg-amber-500" : "bg-destructive"}`}>
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    {user?.name?.substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">{user?.name}</p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {user?.email}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                <span>{t("logout")}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      </header>

      <NotificationsDrawer open={notifOpen} onClose={() => setNotifOpen(false)} />

      {/* Logout checklist modal */}
      <Dialog open={logoutModalOpen} onOpenChange={v => { if (!confirmingLogout) setLogoutModalOpen(v); }}>
        <DialogContent className="max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-right">
              <ClipboardCheck className="h-5 w-5 text-primary" />
              مراجعة المهام قبل الخروج
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground mb-3 text-right">
              {doneCount} من {checklistTasks.length} مهمة مُنجزة اليوم
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {checklistTasks.map(task => {
                const isDone = localDone.has(task.id);
                return (
                  <button
                    key={task.id}
                    onClick={() => toggleTask(task)}
                    disabled={toggling === task.id}
                    className={`w-full flex items-start gap-3 p-3 rounded-lg border transition-all text-right ${
                      isDone ? "bg-emerald-50 border-emerald-200" : "bg-card border-border hover:border-primary/40"
                    }`}
                  >
                    <span className="mt-0.5 shrink-0">
                      {toggling === task.id ? (
                        <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin inline-block" />
                      ) : isDone ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground/50" />
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${isDone ? "line-through text-muted-foreground" : ""}`}>
                        {task.title}
                      </p>
                      {task.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setLogoutModalOpen(false)} disabled={confirmingLogout}>
              إلغاء
            </Button>
            <Button
              variant="destructive"
              onClick={confirmLogout}
              disabled={confirmingLogout}
            >
              {confirmingLogout ? "جارٍ الخروج..." : "تسجيل الخروج"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
