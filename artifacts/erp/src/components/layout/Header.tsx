import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useLogout } from "@workspace/api-client-react";
import { Bell, Globe, LogOut, Menu, UserCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useQuery } from "@tanstack/react-query";
import { NotificationsDrawer } from "@/components/notifications/NotificationsDrawer";

export function Header({ onMenuClick }: { onMenuClick?: () => void }) {
  const { t, language, setLanguage, isRtl } = useI18n();
  const { user } = useAuth();
  const logout = useLogout();
  const [notifOpen, setNotifOpen] = useState(false);

  const token = () => localStorage.getItem("erp_token") ?? "";

  // Badge count — lightweight poll every 60s
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

  const handleLogout = () => {
    localStorage.removeItem("erp_token");
    logout.mutate(undefined);
    window.location.href = "/login";
  };

  const toggleLanguage = () => {
    setLanguage(language === "fr" ? "ar" : "fr");
  };

  return (
    <>
      <header className="h-16 border-b bg-card flex items-center justify-between px-4 lg:px-6 z-10 shrink-0">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={onMenuClick}>
            <Menu className="h-5 w-5" />
          </Button>
          
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <Button variant="ghost" size="icon" onClick={toggleLanguage} title={t("language")}>
            <Globe className="h-5 w-5" />
          </Button>

          {/* Bell with live badge */}
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
      </header>

      <NotificationsDrawer open={notifOpen} onClose={() => setNotifOpen(false)} />
    </>
  );
}
