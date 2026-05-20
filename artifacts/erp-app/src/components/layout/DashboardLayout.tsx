import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { PageErrorBoundary } from "@/components/ErrorBoundary";
import { ReactNode } from "react";
import { useLocation } from "wouter";

export function DashboardLayout({ children }: { children: ReactNode }) {
  const { isRtl } = useI18n();
  const { isAuthenticated, isLoading } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [location] = useLocation();

  if (isLoading) {
    return <div className="flex h-screen w-full items-center justify-center bg-background"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className={`flex h-screen overflow-hidden bg-background ${isRtl ? 'rtl' : 'ltr'}`}>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-col flex-1 w-full overflow-hidden">
        <Header onMenuClick={() => setSidebarOpen(o => !o)} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 bg-secondary/30">
          <PageErrorBoundary key={location}>
            {children}
          </PageErrorBoundary>
        </main>
      </div>
    </div>
  );
}
