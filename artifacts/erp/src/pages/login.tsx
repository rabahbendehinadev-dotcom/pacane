import { useState } from "react";
import { useLogin } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, CheckCircle2, Circle, ClipboardCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";

interface ChecklistTask {
  id: number;
  title: string;
  description: string | null;
  isDone: boolean;
}

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { t, isRtl } = useI18n();
  const { toast } = useToast();
  const [checklistTasks, setChecklistTasks] = useState<ChecklistTask[]>([]);
  const [localDone, setLocalDone] = useState<Set<number>>(new Set());
  const [checklistToken, setChecklistToken] = useState<string>("");
  const [showChecklist, setShowChecklist] = useState(false);
  const [toggling, setToggling] = useState<number | null>(null);

  const loginMutation = useLogin({
    mutation: {
      onSuccess: async (data) => {
        localStorage.setItem("erp_token", data.token);
        try {
          const r = await fetch("/api/checklist/my", {
            headers: { Authorization: `Bearer ${data.token}` }
          });
          if (r.ok) {
            const tasks: ChecklistTask[] = await r.json();
            if (tasks.length > 0) {
              const doneSet = new Set(tasks.filter(t => t.isDone).map(t => t.id));
              setChecklistTasks(tasks);
              setLocalDone(doneSet);
              setChecklistToken(data.token);
              setShowChecklist(true);
              return;
            }
          }
        } catch {
          // no tasks or error — proceed to dashboard
        }
        window.location.href = "/";
      },
      onError: (error) => {
        toast({
          title: t("error"),
          description: error.message || t("somethingWentWrong"),
          variant: "destructive"
        });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    loginMutation.mutate({ data: { username, password } });
  };

  const toggleTask = async (task: ChecklistTask) => {
    const nowDone = !localDone.has(task.id);
    setToggling(task.id);
    try {
      const action = nowDone ? "complete" : "uncomplete";
      await fetch(`/api/checklist/${task.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${checklistToken}` },
      });
      setLocalDone(prev => {
        const next = new Set(prev);
        if (nowDone) next.add(task.id); else next.delete(task.id);
        return next;
      });
    } catch {
      // silent
    } finally {
      setToggling(null);
    }
  };

  const doneCount = checklistTasks.filter(t => localDone.has(t.id)).length;

  return (
    <>
      <div className={`min-h-screen w-full flex items-center justify-center bg-secondary/30 ${isRtl ? 'rtl' : 'ltr'}`}>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background" />
        
        <Card className="w-full max-w-md relative z-10 shadow-2xl border-none">
          <CardHeader className="space-y-4 items-center text-center pt-10">
            <div className="flex items-center justify-center">
              <img src="/logo.png" alt="Pacane" className="h-20 w-auto object-contain" />
            </div>
            <div className="space-y-2">
              <CardTitle className="sr-only">Pacane</CardTitle>
              <CardDescription className="text-base">{t("loginToAccount")}</CardDescription>
            </div>
          </CardHeader>
          <form onSubmit={handleSubmit} noValidate>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="username">{t("username")}</Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="h-12 bg-background"
                  placeholder="admin"
                  autoComplete="username"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">{t("password")}</Label>
                </div>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 bg-background"
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>
            </CardContent>
            <CardFooter className="pb-10">
              <Button 
                type="submit" 
                className="w-full h-12 text-base font-medium" 
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    {t("signingIn")}
                  </>
                ) : (
                  t("login")
                )}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>

      {/* Post-login checklist modal */}
      <Dialog open={showChecklist} onOpenChange={() => {}}>
        <DialogContent className="max-w-sm" dir="rtl" onInteractOutside={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-right">
              <ClipboardCheck className="h-5 w-5 text-primary" />
              مهام اليوم
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground mb-3 text-right">
              {doneCount} من {checklistTasks.length} مهمة مُنجزة — يمكنك تحديث الحالة الآن
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
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
          <DialogFooter>
            <Button className="w-full" onClick={() => { window.location.href = "/"; }}>
              متابعة إلى لوحة التحكم
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
