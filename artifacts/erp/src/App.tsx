import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/lib/i18n";
import { AuthProvider, useAuth } from "@/lib/auth";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";

import Dashboard from "@/pages/dashboard";
import Branches from "@/pages/branches";
import Products from "@/pages/products";
import Categories from "@/pages/categories";
import Units from "@/pages/units";
import Contacts from "@/pages/contacts";
import Users from "@/pages/users";
import Roles from "@/pages/roles";
import Stock from "@/pages/stock";
import Purchases from "@/pages/purchases";
import Sales from "@/pages/sales";
import POS from "@/pages/pos";
import Recipes from "@/pages/recipes";
import Production from "@/pages/production";
import Transfers from "@/pages/transfers";
import Adjustments from "@/pages/adjustments";
import Expenses from "@/pages/expenses";
import Reports from "@/pages/reports";
import Settings from "@/pages/settings";
import Returns from "@/pages/returns";
import PosAnalytics from "@/pages/pos-analytics";
import Treasury from "@/pages/treasury";
import AnalyticsPurchases from "@/pages/analytics-purchases";
import AnalyticsProduction from "@/pages/analytics-production";
import AnalyticsSales from "@/pages/analytics-sales";
import ExecutiveDashboard from "@/pages/executive-dashboard";
import LoyaltyPage from "@/pages/loyalty";
import PurchaseReturnsPage from "@/pages/purchase-returns";
import ReplenishmentPage from "@/pages/replenishment";
import InternalConsumptions from "@/pages/internal-consumptions";
import InternalConsumptionReports from "@/pages/internal-consumptions-reports";
import Receptions from "@/pages/receptions";
import WorkersPage from "@/pages/workers";
import WorkerFichePage from "@/pages/worker-fiche";
import PreparationOrdersPage from "@/pages/preparation-orders";
import MyPreparationsPage from "@/pages/my-preparations";
import AnalyticsSellers from "@/pages/analytics-sellers";
import WhatsappTemplatesPage from "@/pages/whatsapp-templates";
import IntelligencePage from "@/pages/intelligence";
import AiControlPage from "@/pages/ai-control";
import ChecklistPage from "@/pages/checklist";
import StockRupturesPage from "@/pages/stock-ruptures";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

/** Redirige vers /pos si l'utilisateur n'a pas la permission dashboard.view */
function HomeRoute() {
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();

  if (isLoading) {
    return <div className="flex h-screen w-full items-center justify-center bg-background"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }

  const perms: string[] = (user as any)?.permissions ?? [];
  const isAdmin = !!(user as any)?.adminAccess;
  const hasDashboard = isAdmin || perms.includes("*") || perms.includes("dashboard.view");

  if (!hasDashboard && user) {
    const fallback =
      perms.some(p => p.startsWith("pos.")) ? "/pos" :
      perms.some(p => p.startsWith("sales.")) ? "/sales" :
      perms.some(p => p.startsWith("purchases.")) ? "/purchases" :
      perms.some(p => p.startsWith("production.")) ? "/production" :
      "/pos";
    navigate(fallback, { replace: true });
    return null;
  }

  return <DashboardLayout><Dashboard /></DashboardLayout>;
}

function StripTrailingSlash() {
  const [location, navigate] = useLocation();
  if (location !== "/" && location.endsWith("/")) {
    navigate(location.slice(0, -1), { replace: true });
  }
  return null;
}

function AppRoutes() {
  return (
    <>
      <StripTrailingSlash />
      <Switch>
      <Route path="/login" component={Login} />

      <Route path="/">
        <HomeRoute />
      </Route>
      <Route path="/branches">
        <DashboardLayout><Branches /></DashboardLayout>
      </Route>
      <Route path="/users">
        <DashboardLayout><Users /></DashboardLayout>
      </Route>
      <Route path="/roles">
        <DashboardLayout><Roles /></DashboardLayout>
      </Route>
      <Route path="/contacts">
        <DashboardLayout><Contacts /></DashboardLayout>
      </Route>
      <Route path="/products">
        <DashboardLayout><Products /></DashboardLayout>
      </Route>
      <Route path="/categories">
        <DashboardLayout><Categories /></DashboardLayout>
      </Route>
      <Route path="/units">
        <DashboardLayout><Units /></DashboardLayout>
      </Route>
      <Route path="/stock">
        <DashboardLayout><Stock /></DashboardLayout>
      </Route>
      <Route path="/purchases">
        <DashboardLayout><Purchases /></DashboardLayout>
      </Route>
      <Route path="/sales">
        <DashboardLayout><Sales /></DashboardLayout>
      </Route>
      <Route path="/pos">
        <DashboardLayout><POS /></DashboardLayout>
      </Route>
      <Route path="/recipes">
        <DashboardLayout><Recipes /></DashboardLayout>
      </Route>
      <Route path="/production">
        <DashboardLayout><Production /></DashboardLayout>
      </Route>
      <Route path="/transfers">
        <DashboardLayout><Transfers /></DashboardLayout>
      </Route>
      <Route path="/adjustments">
        <DashboardLayout><Adjustments /></DashboardLayout>
      </Route>
      <Route path="/expenses">
        <DashboardLayout><Expenses /></DashboardLayout>
      </Route>
      <Route path="/reports">
        <DashboardLayout><Reports /></DashboardLayout>
      </Route>
      <Route path="/settings">
        <DashboardLayout><Settings /></DashboardLayout>
      </Route>
      <Route path="/purchase-returns">
        <DashboardLayout><PurchaseReturnsPage /></DashboardLayout>
      </Route>
      <Route path="/returns">
        <DashboardLayout><Returns /></DashboardLayout>
      </Route>
      <Route path="/pos-analytics">
        <DashboardLayout><PosAnalytics /></DashboardLayout>
      </Route>
      <Route path="/treasury">
        <DashboardLayout><Treasury /></DashboardLayout>
      </Route>
      <Route path="/analytics/purchases">
        <DashboardLayout><AnalyticsPurchases /></DashboardLayout>
      </Route>
      <Route path="/analytics/production">
        <DashboardLayout><AnalyticsProduction /></DashboardLayout>
      </Route>
      <Route path="/analytics/sales">
        <DashboardLayout><AnalyticsSales /></DashboardLayout>
      </Route>
      <Route path="/analytics/sellers">
        <DashboardLayout><AnalyticsSellers /></DashboardLayout>
      </Route>
      <Route path="/dashboard/executive">
        <DashboardLayout><ExecutiveDashboard /></DashboardLayout>
      </Route>
      <Route path="/loyalty/:tab?">
        <DashboardLayout><LoyaltyPage /></DashboardLayout>
      </Route>
      <Route path="/replenishment">
        <DashboardLayout><ReplenishmentPage /></DashboardLayout>
      </Route>
      <Route path="/internal-consumptions">
        <DashboardLayout><InternalConsumptions /></DashboardLayout>
      </Route>
      <Route path="/internal-consumptions/reports">
        <DashboardLayout><InternalConsumptionReports /></DashboardLayout>
      </Route>
      <Route path="/receptions">
        <DashboardLayout><Receptions /></DashboardLayout>
      </Route>
      <Route path="/workers">
        <DashboardLayout><WorkersPage /></DashboardLayout>
      </Route>
      <Route path="/workers/:id">
        <DashboardLayout><WorkerFichePage /></DashboardLayout>
      </Route>
      <Route path="/preparation-orders">
        <DashboardLayout><PreparationOrdersPage /></DashboardLayout>
      </Route>
      <Route path="/my-preparations">
        <DashboardLayout><MyPreparationsPage /></DashboardLayout>
      </Route>
      <Route path="/intelligence">
        <DashboardLayout><IntelligencePage /></DashboardLayout>
      </Route>
      <Route path="/ai-control">
        <DashboardLayout><AiControlPage /></DashboardLayout>
      </Route>
      <Route path="/whatsapp-templates">
        <DashboardLayout><WhatsappTemplatesPage /></DashboardLayout>
      </Route>
      <Route path="/checklist">
        <DashboardLayout><ChecklistPage /></DashboardLayout>
      </Route>
      <Route path="/stock/ruptures">
        <DashboardLayout><StockRupturesPage /></DashboardLayout>
      </Route>

      <Route component={NotFound} />
    </Switch>
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <AuthProvider>
                <ErrorBoundary>
                  <AppRoutes />
                </ErrorBoundary>
              </AuthProvider>
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </I18nProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
