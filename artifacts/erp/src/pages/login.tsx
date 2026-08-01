import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Clock, Smartphone, Monitor, ShieldX } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

// ── Persistent device ID (per browser-install, stored in localStorage) ────────
function getOrCreateDeviceId(): string {
  const KEY = "erp_device_id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
        });
    localStorage.setItem(KEY, id);
  }
  return id;
}

interface PendingInfo { deviceType?: string; deviceName?: string; isPending?: boolean; }

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [blockedInfo, setBlockedInfo] = useState<PendingInfo | null>(null);
  const { t, isRtl } = useI18n();
  const { toast } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) return;
    setIsLoading(true);
    setBlockedInfo(null);
    try {
      const deviceId = getOrCreateDeviceId();
      const r = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, deviceId }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        localStorage.setItem("erp_token", (data as any).token);
        window.location.href = "/";
      } else if ((data as any).code === "DEVICE_PENDING_APPROVAL") {
        setBlockedInfo({
          deviceType: (data as any).deviceType,
          deviceName: (data as any).deviceName,
          isPending: (data as any).isPending ?? false,
        });
      } else {
        toast({
          title: t("error"),
          description: (data as any).error || t("somethingWentWrong"),
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: t("error"), description: t("somethingWentWrong"), variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className={`min-h-screen w-full flex flex-col items-center justify-center bg-secondary/30 ${isRtl ? "rtl" : "ltr"}`}>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background" />

      <Card className="w-full max-w-md relative z-10 shadow-2xl border-none">
        {blockedInfo ? (
          <>
            <CardHeader className="space-y-4 items-center text-center pt-10">
              <div className="flex items-center justify-center">
                <img src="/logo.png" alt="Pacane" className="h-20 w-auto object-contain" />
              </div>
              <div className={`h-16 w-16 rounded-full flex items-center justify-center mx-auto ${blockedInfo.isPending ? "bg-yellow-100" : "bg-orange-100"}`}>
                {blockedInfo.isPending
                  ? <Clock className="h-8 w-8 text-yellow-600" />
                  : <ShieldX className="h-8 w-8 text-orange-600" />
                }
              </div>
              <div>
                <CardTitle className="text-lg">
                  {blockedInfo.isPending ? "En attente d'approbation" : "Accès restreint"}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="text-center space-y-4 pb-2">
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                {blockedInfo.deviceType === "mobile"
                  ? <Smartphone className="h-5 w-5 text-orange-600" />
                  : <Monitor className="h-5 w-5 text-orange-600" />}
                <span className="text-sm font-medium">
                  {blockedInfo.deviceType === "mobile" ? "Appareil mobile" : "Ordinateur"}
                </span>
              </div>

              <div className={`rounded-lg border p-4 text-sm leading-relaxed ${
                blockedInfo.isPending
                  ? "bg-yellow-50 border-yellow-200 text-yellow-800"
                  : "bg-orange-50 border-orange-200 text-orange-800"
              }`}>
                <p className="font-semibold mb-1">
                  {blockedInfo.isPending
                    ? "Votre demande est en attente d'approbation."
                    : "Ce compte est déjà lié à un autre appareil."}
                </p>
                <p>
                  {blockedInfo.isPending
                    ? "L'administration sera notifiée. Une fois approuvé, l'ancien appareil sera révoqué et vous pourrez vous connecter."
                    : "Veuillez contacter l'administration pour associer cet appareil à votre compte."}
                </p>
              </div>
            </CardContent>
            <CardFooter className="pb-10 flex-col gap-3">
              <Button variant="outline" className="w-full" onClick={() => setBlockedInfo(null)}>
                Retour à la connexion
              </Button>
            </CardFooter>
          </>
        ) : (
          <>
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
              <CardFooter className="pb-10 flex-col gap-4">
                <Button
                  type="submit"
                  className="w-full h-12 text-base font-medium"
                  disabled={isLoading}
                >
                  {isLoading ? (
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
          </>
        )}
      </Card>

      <p className="relative z-10 mt-6 text-xs text-muted-foreground/60 text-center select-none">
        Developed by <span className="font-medium text-muted-foreground/80">Rabah Bendehina</span>
      </p>
    </div>
  );
}
