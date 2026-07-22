import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Bell, BellOff, Loader2, Monitor, Smartphone, Search, Users } from "lucide-react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");
function authHeader() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("erp_token")}` };
}

function pushStatusLabel(subs: number): { label: string; color: string } {
  if (subs > 0) return { label: "Activé", color: "bg-green-100 text-green-700" };
  return { label: "Non activé", color: "bg-slate-100 text-slate-500" };
}

export default function NotificationStatusPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  const { data: users, isLoading } = useQuery({
    queryKey: ["notification-push-status"],
    queryFn: async () => {
      const r = await fetch(`${API}/api/worker-notifications/push-status`, { headers: authHeader() });
      if (!r.ok) throw new Error("Erreur");
      return r.json();
    },
    staleTime: 60_000,
  });

  const perms: string[] = (user as any)?.permissions ?? [];
  function hasPerm(p: string) {
    if (perms.includes("*")) return true;
    if (perms.includes(p)) return true;
    const mod = p.split(".")[0];
    return perms.includes(`${mod}.*`);
  }
  if (!user?.adminAccess && !hasPerm("notif_status.view")) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">Accès non autorisé</div>;
  }

  const allUsers: any[] = users ?? [];

  const filtered = allUsers.filter(u => {
    const matchSearch = !search || u.name?.toLowerCase().includes(search.toLowerCase()) || u.worker_name?.toLowerCase().includes(search.toLowerCase());
    const hasPush = parseInt(u.active_subscriptions ?? 0) > 0;
    if (filterStatus === "active" && !hasPush) return false;
    if (filterStatus === "inactive" && hasPush) return false;
    return matchSearch;
  });

  const withPush = allUsers.filter(u => parseInt(u.active_subscriptions ?? 0) > 0).length;
  const withoutPush = allUsers.length - withPush;
  const pct = allUsers.length > 0 ? Math.round((withPush / allUsers.length) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Bell className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Statut des notifications</h1>
          <p className="text-sm text-muted-foreground">Qui a activé les notifications push et qui ne l'a pas fait</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total utilisateurs", value: allUsers.length, color: "text-foreground", icon: Users },
          { label: "Push activé", value: withPush, color: "text-green-600", icon: Bell },
          { label: "Non activé", value: withoutPush, color: "text-slate-500", icon: BellOff },
          { label: "Taux d'activation", value: `${pct}%`, color: "text-primary", icon: Bell },
        ].map(s => (
          <Card key={s.label} className="text-center">
            <CardContent className="py-4">
              <s.icon className={`h-5 w-5 mx-auto mb-1 ${s.color}`} />
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher par nom ou employé..."
            className="pl-9"
          />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les utilisateurs</SelectItem>
            <SelectItem value="active">Push activé seulement</SelectItem>
            <SelectItem value="inactive">Non activé seulement</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Utilisateur</th>
                  <th className="px-3 py-2 text-left">Employé</th>
                  <th className="px-3 py-2 text-left">Boutique</th>
                  <th className="px-3 py-2 text-left">Statut push</th>
                  <th className="px-3 py-2 text-left">Appareils</th>
                  <th className="px-3 py-2 text-left">Navigateur / OS</th>
                  <th className="px-3 py-2 text-left">Dernière activité</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((u: any) => {
                  const ps = pushStatusLabel(parseInt(u.active_subscriptions ?? 0));
                  return (
                    <tr key={u.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2">
                        <div className="font-medium">{u.name}</div>
                        <div className="text-xs text-muted-foreground">{u.phone || "—"}</div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">{u.worker_name || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">{u.branch_name || "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${ps.color}`}>{ps.label}</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1 text-xs">
                          {parseInt(u.active_subscriptions ?? 0) > 0 ? (
                            <>
                              {u.os?.toLowerCase().includes("android") || u.os?.toLowerCase().includes("ios") ? (
                                <Smartphone className="h-3 w-3 text-muted-foreground" />
                              ) : (
                                <Monitor className="h-3 w-3 text-muted-foreground" />
                              )}
                              <span>{u.active_subscriptions}</span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {u.browser || u.os ? `${u.browser ?? ""} ${u.os ?? ""}`.trim() : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {u.last_login ? new Date(u.last_login).toLocaleDateString("fr-FR") : "—"}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-muted-foreground text-sm">Aucun résultat</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
