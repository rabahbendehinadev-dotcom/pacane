import { useState, useEffect } from "react";
import { RefreshCw, X } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";

export function PWAUpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      if (r) {
        setInterval(() => r.update(), 60 * 60 * 1000);
      }
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] w-[calc(100%-2rem)] max-w-sm">
      <div className="bg-black text-white rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight">تحديث جديد متاح</p>
          <p className="text-xs text-white/70 mt-0.5 leading-tight">اضغط لإعادة تحميل التطبيق</p>
        </div>
        <button
          onClick={() => updateServiceWorker(true)}
          className="flex items-center gap-1.5 bg-white text-black text-xs font-semibold px-3 py-1.5 rounded-xl shrink-0 hover:bg-white/90 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          تحديث
        </button>
        <button
          onClick={() => setNeedRefresh(false)}
          className="text-white/60 hover:text-white p-1 rounded-lg transition-colors shrink-0"
          aria-label="إغلاق"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
