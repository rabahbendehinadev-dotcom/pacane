import { useState, useEffect } from "react";
import { Share, Plus, X, Smartphone, Chrome } from "lucide-react";

type Platform = "ios" | "android" | "desktop" | null;

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
  const isAndroid = /Android/.test(ua);
  if (isIOS) return "ios";
  if (isAndroid) return "android";
  return "desktop";
}

function isInStandaloneMode(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

const DISMISSED_KEY = "pwa_install_dismissed_at";
const DISMISS_COOLDOWN_DAYS = 7;

function shouldShow(): boolean {
  if (isInStandaloneMode()) return false;
  const dismissed = localStorage.getItem(DISMISSED_KEY);
  if (!dismissed) return true;
  const daysSince = (Date.now() - parseInt(dismissed)) / (1000 * 60 * 60 * 24);
  return daysSince >= DISMISS_COOLDOWN_DAYS;
}

export function PWAInstallPrompt() {
  const [platform, setPlatform] = useState<Platform>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [show, setShow] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const p = detectPlatform();
    setPlatform(p);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);

    const timer = setTimeout(() => {
      if (shouldShow()) setShow(true);
    }, 4000);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (deferredPrompt && shouldShow()) setShow(true);
  }, [deferredPrompt]);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, Date.now().toString());
    setShow(false);
  }

  async function handleInstall() {
    if (deferredPrompt) {
      setInstalling(true);
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        localStorage.setItem(DISMISSED_KEY, (Date.now() + 1000 * 60 * 60 * 24 * 365).toString());
      }
      setDeferredPrompt(null);
      setInstalling(false);
      setShow(false);
    }
  }

  if (!show || platform === null) return null;

  return (
    <div className="fixed inset-0 z-[9998] flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
        <div className="bg-black px-6 py-5 flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl overflow-hidden bg-white/10 flex items-center justify-center shrink-0">
            <img src="/logo.png" alt="Pacane" className="w-full h-full object-cover" />
          </div>
          <div>
            <h2 className="text-white font-bold text-lg leading-tight">Pacane ERP</h2>
            <p className="text-white/60 text-xs mt-0.5">أضف التطبيق إلى شاشتك الرئيسية</p>
          </div>
          <button
            onClick={dismiss}
            className="ml-auto text-white/50 hover:text-white p-1 rounded-full transition-colors shrink-0"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5">
          {platform === "ios" && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 font-medium">لتثبيت التطبيق على iPhone:</p>
              <div className="space-y-3">
                <div className="flex items-start gap-3 bg-gray-50 rounded-2xl px-4 py-3">
                  <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5">1</div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">اضغط على زر المشاركة</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Share className="h-4 w-4 text-blue-500" />
                      <span className="text-xs text-gray-500">في شريط Safari السفلي</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-3 bg-gray-50 rounded-2xl px-4 py-3">
                  <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5">2</div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">اختر «إضافة إلى الشاشة الرئيسية»</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Plus className="h-4 w-4 text-gray-400" />
                      <span className="text-xs text-gray-500">Add to Home Screen</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-3 bg-gray-50 rounded-2xl px-4 py-3">
                  <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5">3</div>
                  <div>
                    <p className="text-sm font-medium text-gray-800">اضغط «إضافة» للتأكيد</p>
                    <p className="text-xs text-gray-500 mt-0.5">التطبيق سيظهر على شاشتك الرئيسية</p>
                  </div>
                </div>
              </div>
              <button
                onClick={dismiss}
                className="w-full bg-black text-white text-sm font-semibold py-3 rounded-2xl hover:bg-gray-900 transition-colors"
              >
                فهمت
              </button>
            </div>
          )}

          {platform === "android" && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 font-medium">ثبّت التطبيق على جهازك:</p>
              <div className="bg-gray-50 rounded-2xl px-4 py-3 flex items-center gap-3">
                <Chrome className="h-8 w-8 text-green-600 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-800">تثبيت Pacane ERP</p>
                  <p className="text-xs text-gray-500 mt-0.5">يعمل بشكل مستقل بدون متصفح</p>
                </div>
              </div>
              <div className="space-y-2">
                <button
                  onClick={handleInstall}
                  disabled={installing || !deferredPrompt}
                  className="w-full bg-black text-white text-sm font-semibold py-3 rounded-2xl hover:bg-gray-900 transition-colors disabled:opacity-50"
                >
                  {installing ? "جارٍ التثبيت..." : "تثبيت التطبيق"}
                </button>
                <button
                  onClick={dismiss}
                  className="w-full bg-gray-100 text-gray-600 text-sm font-medium py-3 rounded-2xl hover:bg-gray-200 transition-colors"
                >
                  ليس الآن
                </button>
              </div>
            </div>
          )}

          {platform === "desktop" && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 font-medium">ثبّت التطبيق على حاسوبك:</p>
              <div className="bg-gray-50 rounded-2xl px-4 py-3 flex items-center gap-3">
                <Smartphone className="h-8 w-8 text-blue-600 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-gray-800">تثبيت Pacane ERP</p>
                  <p className="text-xs text-gray-500 mt-0.5">تجربة أفضل كتطبيق مستقل</p>
                </div>
              </div>
              <div className="space-y-2">
                {deferredPrompt ? (
                  <button
                    onClick={handleInstall}
                    disabled={installing}
                    className="w-full bg-black text-white text-sm font-semibold py-3 rounded-2xl hover:bg-gray-900 transition-colors disabled:opacity-50"
                  >
                    {installing ? "جارٍ التثبيت..." : "تثبيت"}
                  </button>
                ) : (
                  <p className="text-xs text-gray-500 text-center bg-gray-50 rounded-2xl px-4 py-3">
                    استخدم زر التثبيت في شريط عنوان المتصفح
                  </p>
                )}
                <button
                  onClick={dismiss}
                  className="w-full bg-gray-100 text-gray-600 text-sm font-medium py-3 rounded-2xl hover:bg-gray-200 transition-colors"
                >
                  ليس الآن
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function usePWAInstall() {
  return {
    isInstalled: isInStandaloneMode(),
    resetDismissal: () => localStorage.removeItem(DISMISSED_KEY),
  };
}
