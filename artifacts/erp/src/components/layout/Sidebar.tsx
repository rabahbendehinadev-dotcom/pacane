import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Store,
  Users,
  Shield,
  ContactRound,
  Package,
  Tags,
  Scale,
  Boxes,
  ShoppingCart,
  ChefHat,
  Factory,
  ArrowLeftRight,
  Wrench,
  SlidersHorizontal,
  PackageX,
  FileText,
  MonitorSmartphone,
  Wallet,
  BarChart4,
  Settings,
  RotateCcw,
  PieChart,
  Landmark,
  TrendingUp,
  BarChart2,
  Layers,
  Heart,
  Undo2,
  ClipboardList,
  PackageCheck,
  HardHat,
  ClipboardCheck,
  Send,
  MessageCircle,
  Brain,
  Cpu,
  Bell,
  AlertCircle,
  BellRing,
  Ticket,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

// Même logique que le backend: P.hasPermission
function hasPerm(userPerms: string[], required: string | string[]): boolean {
  if (userPerms.includes("*")) return true;
  const reqs = Array.isArray(required) ? required : [required];
  return reqs.some(r => {
    if (userPerms.includes(r)) return true;
    const module = r.split(".")[0];
    return userPerms.includes(`${module}.*`);
  });
}

export function Sidebar({ open, onClose }: { open?: boolean; onClose?: () => void }) {
  const { t, isRtl } = useI18n();
  const [location] = useLocation();
  const { user } = useAuth();

  const perms: string[] = (user as any)?.permissions ?? [];

  const navGroups = [
    {
      title: "Direction",
      items: [
        { label: "Tableau de bord gérant", href: "/dashboard/executive", icon: Layers, perm: "reports.view" },
        { label: "Intelligence ERP", href: "/intelligence", icon: Brain, perm: "analytics.view" },
        { label: "AI Control Center", href: "/ai-control", icon: Cpu, perm: "analytics.view" },
      ],
    },
    {
      title: "Core",
      items: [
        { label: t("dashboard"), href: "/", icon: LayoutDashboard },
        { label: t("branches"), href: "/branches", icon: Store, adminOnly: true },
        { label: t("users"), href: "/users", icon: Users, adminOnly: true },
        { label: t("roles"), href: "/roles", icon: Shield, adminOnly: true },
        { label: t("contacts"), href: "/contacts", icon: ContactRound, perm: "contacts.view" },
      ],
    },
    {
      title: "Catalogue",
      items: [
        { label: t("products"), href: "/products", icon: Package, perm: "products.view" },
        { label: t("categories"), href: "/categories", icon: Tags, perm: "products.view" },
        { label: t("units"), href: "/units", icon: Scale, perm: "products.view" },
        { label: "Ouvriers", href: "/workers", icon: HardHat, perm: "workers.view" },
        { label: "Gestion RH", href: "/workers/hr", icon: BarChart2, perm: "workers.view" },
        { label: "Recettes", href: "/recipes", icon: ChefHat, perm: "recipes.view" },
      ],
    },
    {
      title: "Opérations",
      items: [
        { label: t("stock"), href: "/stock", icon: Boxes, perm: "stock.view" },
        { label: t("purchases"), href: "/purchases", icon: ShoppingCart, perm: "purchases.view" },
        { label: "Réceptions", href: "/receptions", icon: PackageCheck, perm: "purchases.view" },
        { label: "Retours fournisseurs", href: "/purchase-returns", icon: Undo2, perm: "purchase_returns.view" },
        { label: "Commande automatique", href: "/replenishment", icon: ClipboardList, perm: "replenishment.view" },
        { label: "Ordres de préparation", href: "/preparation-orders", icon: Send, perm: "preparation_orders.view" },
        { label: "Mes préparations", href: "/my-preparations", icon: ClipboardCheck, perm: "my_preparations.view" },
        { label: t("production"), href: "/production", icon: Factory, perm: "production.view" },
        { label: "Transferts", href: "/transfers", icon: ArrowLeftRight, perm: "transfers.view" },
        { label: "Consommation interne", href: "/internal-consumptions", icon: Wrench, perm: "internal_consumptions.view" },
        { label: "Ajustements", href: "/adjustments", icon: SlidersHorizontal, perm: "adjustments.view" },
        { label: "Ruptures de stock", href: "/stock/ruptures", icon: PackageX, perm: "stock.view" },
      ],
    },
    {
      title: "CRM",
      items: [
        { label: "Fidélité RFM", href: "/loyalty", icon: Heart, perm: "contacts.view" },
        { label: "Modèles WhatsApp", href: "/whatsapp-templates", icon: MessageCircle, perm: "pos.view" },
      ],
    },
    {
      title: "Commercial",
      items: [
        { label: t("sales"), href: "/sales", icon: FileText, perm: "sales.view" },
        { label: t("pos"), href: "/pos", icon: MonitorSmartphone, perm: "pos.view" },
        { label: "Analytique POS", href: "/pos-analytics", icon: PieChart, perm: "analytics.view" },
        { label: "Retours & Avoirs", href: "/returns", icon: RotateCcw, perm: "returns.view" },
        { label: "Dépenses", href: "/expenses", icon: Wallet, perm: "expenses.view" },
      ],
    },
    {
      title: "Analytique",
      items: [
        { label: "Analytique Ventes", href: "/analytics/sales", icon: BarChart2, perm: "analytics.view" },
        { label: "Analytique Vendeurs", href: "/analytics/sellers", icon: Users, perm: "analytics.view" },
        { label: "Analytique Achats", href: "/analytics/purchases", icon: TrendingUp, perm: "analytics.view" },
        { label: "Analytique Production", href: "/analytics/production", icon: Factory, perm: "analytics.view" },
        { label: "Conso. interne", href: "/internal-consumptions/reports", icon: Wrench, perm: "internal_consumptions.view" },
      ],
    },
    {
      title: "Finance",
      items: [
        { label: "Trésorerie", href: "/treasury", icon: Landmark, perm: "treasury.view" },
        { label: t("reports"), href: "/reports", icon: BarChart4, perm: "reports.view" },
      ],
    },
    {
      title: "Équipe",
      items: [
        { label: "Checklist", href: "/checklist", icon: ClipboardCheck },
      ],
    },
    {
      title: "Communications",
      items: [
        { label: "إشعارات العمال", href: "/worker-notifications", icon: Bell, adminOnly: true },
        { label: "بلاغات المستخدمين", href: "/admin-tickets", icon: Ticket, adminOnly: true },
        { label: "حالة الإشعارات", href: "/notification-status", icon: BellRing, adminOnly: true },
        { label: "إشعاراتي", href: "/my-notifications", icon: Bell },
        { label: "تبليغ عن مشكلة", href: "/report-problem", icon: AlertCircle },
        { label: "بلاغاتي", href: "/my-tickets", icon: Ticket },
      ],
    },
    {
      title: "Système",
      items: [
        { label: t("settings"), href: "/settings", icon: Settings, adminOnly: true },
      ],
    },
  ];

  const isVisible = (item: { adminOnly?: boolean; perm?: string }) => {
    if (user?.adminAccess) return true;
    if (item.adminOnly) return false;
    if (!item.perm) return true;
    return hasPerm(perms, item.perm);
  };

  const sidebarContent = (
    <>
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border/50">
        <img src="/logo.png" alt="Pacane" className="h-8 w-auto object-contain" />
      </div>
      <ScrollArea className="flex-1 py-4">
        <div className="space-y-5 px-3">
          {navGroups.map((group, i) => {
            const visibleItems = group.items.filter(item => isVisible(item));
            if (visibleItems.length === 0) return null;
            return (
              <div key={i} className="space-y-0.5">
                <h4 className="px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 mb-1.5">
                  {group.title}
                </h4>
                {visibleItems.map((item, j) => {
                  const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
                  return (
                    <Link
                      key={j}
                      href={item.href}
                      onClick={onClose}
                      className={`flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors ${
                        isActive
                          ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium shadow-sm"
                          : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      }`}
                    >
                      <item.icon className={`h-4 w-4 shrink-0 ${isActive ? "" : "opacity-60"}`} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex-col hidden md:flex">
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="absolute inset-0 bg-black/50" onClick={onClose} />
          <aside className="relative z-10 w-72 max-w-[85vw] bg-sidebar text-sidebar-foreground flex flex-col shadow-xl animate-in slide-in-from-left duration-200">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
