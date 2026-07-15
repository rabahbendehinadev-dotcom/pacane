import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, BellOff, Smartphone, Save, AlertTriangle, Info } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useState, useEffect } from "react";

const token = () => localStorage.getItem("erp_token") ?? "";

interface Prefs {
  pushEnabled: boolean;
  inAppEnabled: boolean;
  prefSales: boolean;
  prefRemise: boolean;
  prefStockLow: boolean;
  prefNewProduct: boolean;
  prefReceivables: boolean;
  prefInvoices: boolean;
  prefReturns: boolean;
  prefExpenses: boolean;
  prefCustomers: boolean;
  prefWorkers: boolean;
  prefAbsence: boolean;
  prefPrimes: boolean;
  prefAvertissements: boolean;
  prefLeaves: boolean;
  prefUpdates: boolean;
  prefSecurity: boolean;
}

const DEFAULTS: Prefs = {
  pushEnabled: true, inAppEnabled: true,
  prefSales: true, prefRemise: true, prefStockLow: true, prefNewProduct: false,
  prefReceivables: true, prefInvoices: true, prefReturns: true, prefExpenses: true,
  prefCustomers: false, prefWorkers: false, prefAbsence: false, prefPrimes: false,
  prefAvertissements: false, prefLeaves: false, prefUpdates: true, prefSecurity: true,
};

type PrefKey = keyof Omit<Prefs, "pushEnabled" | "inAppEnabled">;

const TYPE_SECTIONS: { label: string; items: { key: PrefKey; label: string; desc: string }[] }[] = [
  {
    label: "Ventes & Finance",
    items: [
      { key: "prefSales",       label: "Ventes",        desc: "Nouvelles ventes et bons de commande" },
      { key: "prefRemise",      label: "Remises",        desc: "Remises importantes appliquées en caisse" },
      { key: "prefReceivables", label: "Créances",       desc: "Créances en retard et paiements" },
      { key: "prefInvoices",    label: "Factures",       desc: "Nouvelles factures et bons de livraison" },
      { key: "prefExpenses",    label: "Dépenses",       desc: "Nouvelles dépenses enregistrées" },
      { key: "prefReturns",     label: "Retours",        desc: "Retours clients et fournisseurs" },
    ],
  },
  {
    label: "Stock & Produits",
    items: [
      { key: "prefStockLow",    label: "Stock faible",   desc: "Alertes de stock bas ou épuisé" },
      { key: "prefNewProduct",  label: "Nouveaux produits", desc: "Ajout de nouveaux produits au catalogue" },
    ],
  },
  {
    label: "Clients",
    items: [
      { key: "prefCustomers",   label: "Clients",        desc: "Nouveaux clients et mises à jour" },
    ],
  },
  {
    label: "Ressources Humaines",
    items: [
      { key: "prefWorkers",        label: "Ouvriers",         desc: "Changements dans les profils ouvriers" },
      { key: "prefAbsence",        label: "Absences",         desc: "Absences et retards signalés" },
      { key: "prefPrimes",         label: "Primes",           desc: "Primes et bonus accordés" },
      { key: "prefAvertissements", label: "Avertissements",   desc: "Sanctions et avertissements disciplinaires" },
      { key: "prefLeaves",         label: "Congés",           desc: "Demandes et approbations de congé" },
    ],
  },
  {
    label: "Système",
    items: [
      { key: "prefUpdates",  label: "Mises à jour",   desc: "Nouvelles fonctionnalités et mises à jour ERP" },
      { key: "prefSecurity", label: "Sécurité",        desc: "Connexions suspectes et alertes de sécurité" },
    ],
  },
];

export function NotificationPrefsTab() {
  const qc = useQueryClient();
  const { isPushSupported, isSubscribed, isLoading: pushLoading, isIOS, needsInstall, subscribeError, subscribe, unsubscribe } = usePushNotifications();

  const { data: serverPrefs, isLoading } = useQuery<Prefs>({
    queryKey: ["notification-settings"],
    queryFn: async () => {
      const r = await fetch("/api/notification-settings", { headers: { Authorization: `Bearer ${token()}` } });
      if (!r.ok) return DEFAULTS;
      return r.json();
    },
  });

  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);

  useEffect(() => {
    if (serverPrefs) setPrefs(serverPrefs);
  }, [serverPrefs]);

  const saveMutation = useMutation({
    mutationFn: async (data: Prefs) => {
      const r = await fetch("/api/notification-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("Erreur de sauvegarde");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-settings"] });
      toast({ title: "Préférences enregistrées", description: "Vos préférences de notifications ont été mises à jour." });
    },
    onError: () => {
      toast({ title: "Erreur", description: "Impossible de sauvegarder les préférences.", variant: "destructive" });
    },
  });

  const toggle = (key: keyof Prefs) => setPrefs(p => ({ ...p, [key]: !p[key] }));

  if (isLoading) return <div className="py-12 text-center text-sm text-muted-foreground">Chargement…</div>;

  return (
    <div className="space-y-4">

      {/* ── Channels ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Canaux de notification</CardTitle>
          <CardDescription className="text-xs">Choisissez comment recevoir les notifications</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* In-app */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Bell className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">Notifications in-app</p>
                <p className="text-xs text-muted-foreground">Tiroir de notifications dans l'interface</p>
              </div>
            </div>
            <Switch
              checked={prefs.inAppEnabled}
              onCheckedChange={() => toggle("inAppEnabled")}
            />
          </div>

          {/* Push */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100">
                  <Smartphone className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-medium">Notifications push</p>
                  <p className="text-xs text-muted-foreground">
                    {needsInstall
                      ? "Requiert l'installation de l'app"
                      : !isPushSupported
                      ? "Non supporté par ce navigateur"
                      : isSubscribed
                      ? "✓ Activées sur cet appareil"
                      : "Désactivées sur cet appareil"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {(isPushSupported || needsInstall) && !isSubscribed && (
                  <Button
                    variant={isSubscribed ? "outline" : "default"}
                    size="sm"
                    className="h-8 text-xs"
                    disabled={pushLoading}
                    onClick={isSubscribed ? unsubscribe : subscribe}
                  >
                    {pushLoading ? "…" : isSubscribed ? (
                      <><BellOff className="h-3.5 w-3.5 mr-1" />Désactiver</>
                    ) : (
                      <><Bell className="h-3.5 w-3.5 mr-1" />Activer les notifications</>
                    )}
                  </Button>
                )}
                {isSubscribed && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs text-destructive"
                    disabled={pushLoading}
                    onClick={unsubscribe}
                  >
                    <BellOff className="h-3.5 w-3.5 mr-1" />Désactiver
                  </Button>
                )}
              </div>
            </div>

            {/* iOS install instructions */}
            {needsInstall && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 space-y-2">
                <div className="flex items-center gap-1.5 font-semibold">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  iPhone — Installez l'app pour activer les notifications
                </div>
                <ol className="space-y-1 list-decimal list-inside leading-relaxed">
                  <li>Appuyez sur le bouton <strong>Partager</strong> <span className="inline-block border border-blue-300 rounded px-1">⬆</span> en bas de Safari</li>
                  <li>Faites défiler et tapez <strong>« Sur l'écran d'accueil »</strong></li>
                  <li>Tapez <strong>« Ajouter »</strong> en haut à droite</li>
                  <li>Ouvrez l'app depuis l'icône sur votre écran d'accueil</li>
                  <li>Revenez ici et activez les notifications</li>
                </ol>
                <p className="text-blue-600">Requiert iOS 16.4 minimum.</p>
              </div>
            )}

            {/* Android instructions if not subscribed and no error yet */}
            {!isIOS && isPushSupported && !isSubscribed && !subscribeError && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600 flex items-start gap-2">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>Sur Android, cliquez sur <strong>Activer les notifications</strong> puis sur <strong>Autoriser</strong> dans la fenêtre qui apparaît.</span>
              </div>
            )}

            {/* Error message */}
            {subscribeError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{subscribeError}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Type Preferences ── */}
      {TYPE_SECTIONS.map(section => (
        <Card key={section.label}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {section.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {section.items.map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
                <Switch
                  checked={(prefs as any)[key] as boolean}
                  onCheckedChange={() => toggle(key as keyof Prefs)}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      <Button
        className="gap-2"
        onClick={() => saveMutation.mutate(prefs)}
        disabled={saveMutation.isPending}
      >
        <Save className="h-4 w-4" />
        {saveMutation.isPending ? "Enregistrement…" : "Enregistrer les préférences"}
      </Button>
    </div>
  );
}
