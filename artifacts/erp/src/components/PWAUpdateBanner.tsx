import { useRegisterSW } from "virtual:pwa-register/react";

export function PWAUpdateBanner() {
  useRegisterSW({
    onRegistered(r) {
      if (r) {
        setInterval(() => r.update(), 60 * 60 * 1000);
      }
    },
  });

  return null;
}
