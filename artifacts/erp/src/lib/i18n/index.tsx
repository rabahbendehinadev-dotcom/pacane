import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { fr } from "./fr";
import { ar } from "./ar";

type Language = "fr" | "ar";
type Translations = typeof fr;

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: keyof Translations) => string;
  isRtl: boolean;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

const translations = {
  fr,
  ar,
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem("erp_language");
    return (saved as Language) || "fr";
  });

  const isRtl = language === "ar";

  useEffect(() => {
    document.documentElement.dir = isRtl ? "rtl" : "ltr";
    document.documentElement.lang = language;
    localStorage.setItem("erp_language", language);
  }, [language, isRtl]);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
  };

  const t = (key: keyof Translations): string => {
    return translations[language][key] || key;
  };

  return (
    <I18nContext.Provider value={{ language, setLanguage, t, isRtl }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (context === undefined) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}
