import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Smartphone, Monitor, Trash2, Bell, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

const token = () => localStorage.getItem("erp_token") ?? "";

interface Device {
  id: number;
  deviceName: string | null;
  browser: string | null;
  os: string | null;
  isActive: boolean;
  lastActive: string;
  createdAt: string;
}

function DeviceIcon({ os }: { os: string | null }) {
  if (!os) return <Monitor className="h-4 w-4" />;
  if (/android|ios|iphone|ipad/i.test(os)) return <Smartphone className="h-4 w-4" />;
  return <Monitor className="h-4 w-4" />;
}

export function DevicesTab() {
  const qc = useQueryClient();
  const { isPushSupported, isSubscribed, isLoading: pushLoading, subscribe, unsubscribe } = usePushNotifications();

  const { data: devices = [], isLoading, refetch } = useQuery<Device[]>({
    queryKey: ["push-devices"],
    queryFn: async () => {
      const r = await fetch("/api/push/devices", { headers: { Authorization: `Bearer ${token()}` } });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/push/subscribe/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!r.ok) throw new Error("Erreur lors de la révocation");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["push-devices"] });
      toast({ title: "Appareil révoqué", description: "Les notifications push ont été désactivées pour cet appareil." });
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de révoquer l'appareil.", variant: "destructive" });
    },
  });

  const activeDevices   = devices.filter(d => d.isActive);
  const inactiveDevices = devices.filter(d => !d.isActive);

  return (
    <div className="space-y-4">

      {/* ── Current device ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Cet appareil</CardTitle>
          <CardDescription className="text-xs">
            {!isPushSupported
              ? "Votre navigateur ne supporte pas les notifications push."
              : isSubscribed
              ? "Cet appareil est abonné aux notifications push."
              : "Cet appareil n'est pas abonné aux notifications push."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            {isPushSupported && (
              <Button
                variant={isSubscribed ? "outline" : "default"}
                size="sm"
                className="gap-2"
                disabled={pushLoading}
                onClick={isSubscribed ? async () => { await unsubscribe(); refetch(); } : async () => { await subscribe(); refetch(); }}
              >
                <Bell className="h-4 w-4" />
                {pushLoading ? "…" : isSubscribed ? "Désabonner cet appareil" : "Abonner cet appareil"}
              </Button>
            )}
            <Button variant="ghost" size="sm" className="gap-2" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />Actualiser
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Active devices ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">
              Appareils abonnés
              {activeDevices.length > 0 && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">({activeDevices.length})</span>
              )}
            </CardTitle>
          </div>
          <CardDescription className="text-xs">Appareils recevant actuellement des notifications push</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Chargement…</p>
          ) : activeDevices.length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <Smartphone className="h-8 w-8 text-muted-foreground mx-auto opacity-40" />
              <p className="text-sm text-muted-foreground">Aucun appareil abonné</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeDevices.map(device => (
                <div key={device.id} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/20">
                  <div className="p-2 rounded-md bg-primary/10 shrink-0">
                    <DeviceIcon os={device.os} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{device.deviceName ?? "Appareil inconnu"}</p>
                    <p className="text-xs text-muted-foreground">
                      Actif {formatDistanceToNow(new Date(device.lastActive), { addSuffix: true, locale: fr })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5 bg-green-100 text-green-700 border-green-200">
                      Actif
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 hover:text-destructive hover:bg-red-50"
                      disabled={revokeMutation.isPending}
                      onClick={() => {
                        if (confirm(`Révoquer "${device.deviceName ?? "cet appareil"}" ?`)) {
                          revokeMutation.mutate(device.id);
                        }
                      }}
                      title="Révoquer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Inactive devices ── */}
      {inactiveDevices.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground">
              Appareils inactifs ({inactiveDevices.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {inactiveDevices.map(device => (
                <div key={device.id} className="flex items-center gap-3 p-2.5 rounded-lg border opacity-50">
                  <DeviceIcon os={device.os} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{device.deviceName ?? "Appareil inconnu"}</p>
                    <p className="text-xs text-muted-foreground">
                      Dernier accès {formatDistanceToNow(new Date(device.lastActive), { addSuffix: true, locale: fr })}
                    </p>
                  </div>
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5">Inactif</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
