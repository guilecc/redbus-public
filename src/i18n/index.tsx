import React, { createContext, useContext, useEffect, useState } from 'react';
import en, { Translations } from './locales/en';
import ptBR from './locales/pt-BR';

type Language = 'en' | 'pt-BR';

const dictionaries: Record<Language, Translations> = { en, 'pt-BR': ptBR };

// ── Context ──────────────────────────────────────────────────────────────────

interface I18nContextValue {
  lang: Language;
  t: Translations;
  setLang: (lang: Language) => void;
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'en',
  t: en,
  setLang: () => {},
});

// ── Provider ─────────────────────────────────────────────────────────────────

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>('en');

  // Load persisted language from AppSettings on mount
  useEffect(() => {
    if (window.redbusAPI?.getAppSetting) {
      window.redbusAPI.getAppSetting('language').then((res: any) => {
        if (res?.status === 'OK' && (res.data === 'en' || res.data === 'pt-BR')) {
          setLangState(res.data as Language);
        }
      }).catch(() => {/* ignore — defaults to 'en' */});
    }
  }, []);

  // Listen for language changes dispatched from App.tsx
  useEffect(() => {
    const handler = (e: Event) => {
      const lang = (e as CustomEvent<{ lang: Language }>).detail?.lang;
      if (lang === 'en' || lang === 'pt-BR') setLangState(lang);
    };
    window.addEventListener('redbus-lang-changed', handler);
    return () => window.removeEventListener('redbus-lang-changed', handler);
  }, []);

  const setLang = (next: Language) => {
    setLangState(next);
    // Broadcast to other consumers
    window.dispatchEvent(new CustomEvent('redbus-lang-changed', { detail: { lang: next } }));
  };

  return (
    <I18nContext.Provider value={{ lang, t: dictionaries[lang], setLang }}>
      {children}
    </I18nContext.Provider>
  );
};

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns the full translation object `t` for the current language.
 * Usage:
 *   const { t } = useTranslation();
 *   <button title={t.titlebar.nav.chat}>
 */
export function useTranslation() {
  return useContext(I18nContext);
}
