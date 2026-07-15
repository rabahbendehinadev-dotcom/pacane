/**
 * PushActivationGate
 * Blocking modal shown after login until the user enables push notifications.
 * - Android/Desktop: forces the user to click "Activer" and grant permission.
 * - iOS Safari (not installed): shows install-to-home-screen steps.
 * - Permission denied at browser level: shows how to re-enable in settings.
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Bell, AlertTriangle, Info, CheckCircle2 } from "lucide-react";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useAuth } from "@/lib/auth";

const SESSION_SKIP_KEY = "push_gate_skipped";

export function PushActivationGate() {
  const { isAuthenticated } = useAuth();
  const {
    permission,
    isSubscribed,
    isLoading,
    isReady,
    isPushSupported,
    needsInstall,
    subscribeError,
    subscribe,
  } = usePushNotifications();

  const [skipped, setSkipped] = useState(
    () => sessionStorage.getItem(SESSION_SKIP_KEY) === "1",
  );

  const skip = () => {
    sessionStorage.setItem(SESSION_SKIP_KEY, "1");
    setSkipped(true);
  };

  const permissionDenied = permission === "denied" && !needsInstall;

  const open =
    !import.meta.env.DEV &&
    isAuthenticated &&
    isReady &&
    !isSubscribed &&
    !skipped &&
    (isPushSupported || needsInstall);

  if (!open) return null;

  return (
    <Dialog open modal>
      <DialogContent
        className="max-w-md [&>button]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="flex flex-col items-center text-center space-y-4 py-2">
          <div className="p-4 rounded-full bg-primary/10">
            <Bell className="h-8 w-8 text-primary" />
          </div>

          <div className="space-y-1.5">
            <DialogTitle className="text-lg font-semibold">
              Activation des notifications requise
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Pour recevoir les alertes importantes de l'ERP (ventes, stock,
              messages de l'administration), vous devez activer les
              notifications sur cet appareil.
            </DialogDescription>
          </div>

          {/* iOS Safari — must install first */}
          {needsInstall && (
            <div className="w-full bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 space-y-2 text-left">
              <div className="flex items-center gap-1.5 font-semibold">
                <Info className="h-3.5 w-3.5 shrink-0" />
                iPhone — Installez d'abord l'application
              </div>
              <ol className="space-y-1 list-decimal list-inside leading-relaxed">
                <li>
                  Appuyez sur <strong>Partager</strong>{" "}
                  <span className="inline-block border border-blue-300 rounded px-1">⬆</span>{" "}
                  en bas de Safari
                </li>
                <li>Tapez <strong>« Sur l'écran d'accueil »</strong></li>
                <li>Tapez <strong>« Ajouter »</strong></li>
                <li>Ouvrez l'app depuis l'icône, puis activez les notifications ici</li>
              </ol>
              <p className="text-blue-600">Requiert iOS 16.4 minimum.</p>
            </div>
          )}

          {/* Browser-level permission denied */}
          {permissionDenied && (
            <div className="w-full bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 space-y-1.5 text-left">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Notifications bloquées par le navigateur
              </div>
              <p>
                Vous avez refusé les notifications. Pour les réactiver :
                ouvrez les <strong>réglages du navigateur</strong> →{" "}
                <strong>Notifications</strong> → autorisez ce site, puis
                rechargez la page.
              </p>
            </div>
          )}

          {/* Subscribe error */}
          {subscribeError && !permissionDenied && (
            <div className="w-full bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800 flex items-start gap-2 text-left">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{subscribeError}</span>
            </div>
          )}

          {/* Main action */}
          {!needsInstall && !permissionDenied && (
            <Button
              className="w-full gap-2"
              size="lg"
              disabled={isLoading}
              onClick={subscribe}
            >
              {isLoading ? (
                "Activation en cours…"
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Activer les notifications
                </>
              )}
            </Button>
          )}

          {/* Escape hatch when activation is impossible or has failed */}
          {(needsInstall || permissionDenied || subscribeError) && (
            <button
              onClick={skip}
              className="text-xs text-muted-foreground underline underline-offset-2"
            >
              Continuer sans notifications pour cette session
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
