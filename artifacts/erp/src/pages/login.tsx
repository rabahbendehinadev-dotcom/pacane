import { useState } from "react";
import { useLogin } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { t, isRtl } = useI18n();
  const { toast } = useToast();

  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data) => {
        localStorage.setItem("erp_token", data.token);
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

  return (
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
          <CardFooter className="pb-10 flex-col gap-4">
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
            <p className="text-xs text-muted-foreground text-center">Powered by Rabah Bendehina</p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
