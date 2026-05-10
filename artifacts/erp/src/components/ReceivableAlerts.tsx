import { customFetch } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ShieldOff, Clock, Building2,
  CheckCircle2, CreditCard,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

// ── Types ─────────────────────────────────────────────────────────────────
export interface ReceivableAlert {
  customerId: number;
  contactName: string;
  companyName: string | null;
  city: string | null;
  totalUnpaid: number;
  invoiceCount: number;
  daysOverdue: number;
  oldestInvoiceDate: string;
  creditLimit: number | null;
  creditUsagePct: number | null;
  creditExceeded: boolean;
  lastPaymentDate: string | null;
  branchId: number;
  branchName: string;
  severity: "warning" | "critical";
  alertReasons: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────
function formatDA(n: number): string {
  return new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(n) + " DA";
}

// ── Individual alert card ────────────────────────────────────────────────
interface AlertCardProps {
  alert: ReceivableAlert;
  onOpenContact?: (id: number) => void;
  compact?: boolean;
}

export function ReceivableAlertCard({ alert, onOpenContact, compact = false }: AlertCardProps) {
  const isCritical = alert.severity === "critical";

  const borderColor = isCritical
    ? "border-red-200 bg-red-50/60"
    : "border-amber-200 bg-amber-50/50";

  const badgeCls = isCritical
    ? "bg-red-100 text-red-700 border-red-200"
    : "bg-amber-100 text-amber-700 border-amber-200";

  const iconColor = isCritical ? "text-red-500" : "text-amber-500";
  const amountColor = isCritical ? "text-red-700" : "text-amber-700";

  const Icon = alert.creditExceeded ? ShieldOff : isCritical ? AlertTriangle : Clock;

  return (
    <div
      className={`rounded-xl border p-3 transition-colors ${borderColor} ${onOpenContact ? "cursor-pointer hover:opacity-90" : ""}`}
      onClick={() => onOpenContact?.(alert.customerId)}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={`mt-0.5 shrink-0 ${iconColor}`}>
          <Icon className="h-4 w-4" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Name + severity badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold truncate">{alert.contactName}</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${badgeCls}`}>
              {isCritical ? "CRITIQUE" : "ATTENTION"}
            </span>
          </div>

          {/* Amount */}
          <p className={`text-lg font-bold mt-0.5 ${amountColor}`}>
            {formatDA(alert.totalUnpaid)}
          </p>

          {/* Alert reasons */}
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {alert.alertReasons.map((reason, i) => (
              <span key={i} className="text-[11px] text-muted-foreground bg-background/60 border rounded-full px-2 py-0.5">
                {reason}
              </span>
            ))}
          </div>

          {/* Metadata row */}
          {!compact && (
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                {alert.branchName}
              </span>
              <span>
                {alert.invoiceCount} facture{alert.invoiceCount !== 1 ? "s" : ""}
              </span>
              {alert.creditLimit != null && (
                <span className="flex items-center gap-1">
                  <CreditCard className="h-3 w-3" />
                  {alert.creditUsagePct != null ? `${alert.creditUsagePct}%` : "—"} utilisé
                </span>
              )}
              {alert.lastPaymentDate && (
                <span>
                  Dernier pmt {formatDistanceToNow(new Date(alert.lastPaymentDate), { locale: fr, addSuffix: true })}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Credit progress bar */}
      {!compact && alert.creditLimit != null && (
        <div className="mt-2.5 ml-7">
          <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
            <span>Crédit utilisé</span>
            <span>{formatDA(alert.totalUnpaid)} / {formatDA(alert.creditLimit)}</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
            <div
              className={`h-full rounded-full ${isCritical ? "bg-red-500" : "bg-amber-400"}`}
              style={{ width: `${Math.min(100, alert.creditUsagePct ?? (alert.creditExceeded ? 100 : 0))}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Dashboard widget (full panel) ─────────────────────────────────────────
interface ReceivableAlertsPanelProps {
  branchId?: number | null;
  maxItems?: number;
  onOpenContact?: (id: number) => void;
}

export function ReceivableAlertsPanel({
  branchId,
  maxItems = 5,
  onOpenContact,
}: ReceivableAlertsPanelProps) {
  const params = new URLSearchParams();
  if (branchId) params.set("branchId", String(branchId));

  const { data: rawAlerts, isLoading } = useQuery<ReceivableAlert[]>({
    queryKey: ["receivable-alerts", branchId],
    queryFn: () => customFetch<ReceivableAlert[]>(`/api/receivables/alerts?${params}`),
    refetchInterval: 60_000,
  });
  const alerts: ReceivableAlert[] = Array.isArray(rawAlerts) ? rawAlerts : [];

  const criticalCount = alerts.filter(a => a.severity === "critical").length;
  const displayed = alerts.slice(0, maxItems);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <CheckCircle2 className="h-8 w-8 text-green-400" />
        <p className="text-sm text-muted-foreground">Aucun risque client détecté</p>
        <p className="text-xs text-muted-foreground opacity-70">Tous les clients sont à jour</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Summary badges */}
      {criticalCount > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-semibold text-red-600 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {criticalCount} client{criticalCount > 1 ? "s" : ""} en situation critique
          </span>
        </div>
      )}

      {/* Alert cards */}
      {displayed.map(alert => (
        <ReceivableAlertCard
          key={alert.customerId}
          alert={alert}
          onOpenContact={onOpenContact}
        />
      ))}

      {alerts.length > maxItems && (
        <p className="text-xs text-muted-foreground text-center pt-1">
          + {alerts.length - maxItems} autre{alerts.length - maxItems > 1 ? "s" : ""} alertes
        </p>
      )}
    </div>
  );
}

// ── Compact inline risk indicator (for contact profile) ───────────────────
interface ContactRiskBadgeProps {
  customerId: number;
}

export function ContactRiskBadge({ customerId }: ContactRiskBadgeProps) {
  const { data: alerts = [] } = useQuery<ReceivableAlert[]>({
    queryKey: ["receivable-alerts"],
    queryFn: () => customFetch<ReceivableAlert[]>(`/api/receivables/alerts`),
    staleTime: 60_000,
  });

  const alert = alerts.find(a => a.customerId === customerId);
  if (!alert) return null;

  const isCritical = alert.severity === "critical";
  const Icon = alert.creditExceeded ? ShieldOff : isCritical ? AlertTriangle : Clock;

  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
        isCritical
          ? "bg-red-100 text-red-700 border-red-200"
          : "bg-amber-100 text-amber-700 border-amber-200"
      }`}
    >
      <Icon className="h-3 w-3" />
      {isCritical ? "Risque élevé" : "Attention"}
    </span>
  );
}
