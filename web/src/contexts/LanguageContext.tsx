import { createContext, useContext, useState, useEffect } from 'react';
import { type Language, translations } from './language-data';

export type { Language } from './language-data';

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  hasSelectedLanguage: boolean;
  markLanguageSelected: () => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const LANGUAGE_KEY = 'shipyard-language';
const LANGUAGE_SELECTED_KEY = 'shipyard-language-selected';

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window === 'undefined') return 'en';
    const stored = localStorage.getItem(LANGUAGE_KEY) as Language | null;
    return stored || 'en';
  });

  const [hasSelectedLanguage, setHasSelectedLanguage] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(LANGUAGE_SELECTED_KEY) === 'true';
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem(LANGUAGE_KEY, lang);
  };

  const markLanguageSelected = () => {
    setHasSelectedLanguage(true);
    localStorage.setItem(LANGUAGE_SELECTED_KEY, 'true');
  };

  // Update HTML lang attribute
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, hasSelectedLanguage, markLanguageSelected }}>
      {children}
    </LanguageContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTranslation() {
  const { language } = useLanguage();
  return translations[language];
}