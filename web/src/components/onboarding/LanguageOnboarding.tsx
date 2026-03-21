import { memo, useCallback } from 'react';
import { useLanguage, useTranslation } from '../../contexts/LanguageContext';
import { useTheme } from '../../contexts/ThemeContext';

// Theme button configuration
const THEME_BUTTONS = [
  { key: 'dark', labelKey: 'dark' as const },
  { key: 'light', labelKey: 'light' as const },
  { key: 'system', labelKey: 'system' as const },
] as const;

export const LanguageOnboarding = memo(function LanguageOnboarding() {
  const { language, setLanguage, markLanguageSelected } = useLanguage();
  const { theme, setTheme } = useTheme();
  const t = useTranslation();

  const handleLanguageSelect = useCallback((lang: 'en' | 'ja') => {
    setLanguage(lang);
  }, [setLanguage]);

  const handleContinue = useCallback(() => {
    markLanguageSelected();
  }, [markLanguageSelected]);

  const handleThemeSelect = useCallback((newTheme: 'dark' | 'light' | 'system') => {
    setTheme(newTheme);
  }, [setTheme]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-container-lowest/95 backdrop-blur-sm">
      <div className="w-full max-w-md p-8 bg-surface-container rounded-xl border border-outline-variant/20 shadow-2xl">
        {/* Logo/Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
            <span className="material-symbols-outlined text-4xl text-primary">deployed_code</span>
          </div>
          <h1 className="text-2xl font-bold text-on-surface mb-2">Shipyard CP</h1>
          <p className="text-on-surface-variant text-sm">
            {language === 'en' ? 'Task Board' : 'タスクボード'}
          </p>
        </div>

        {/* Language Selection */}
        <div className="mb-6">
          <label className="text-xs font-mono uppercase tracking-wider text-on-surface-variant mb-3 block">
            {t.selectLanguage}
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleLanguageSelect('en')}
              className={`p-4 rounded-lg border-2 transition-all ${
                language === 'en'
                  ? 'border-primary bg-primary/10'
                  : 'border-outline-variant/20 hover:border-outline-variant'
              }`}
            >
              <span className="text-2xl mb-1 block">🇺🇸</span>
              <span className="text-sm font-medium text-on-surface">English</span>
            </button>
            <button
              onClick={() => handleLanguageSelect('ja')}
              className={`p-4 rounded-lg border-2 transition-all ${
                language === 'ja'
                  ? 'border-primary bg-primary/10'
                  : 'border-outline-variant/20 hover:border-outline-variant'
              }`}
            >
              <span className="text-2xl mb-1 block">🇯🇵</span>
              <span className="text-sm font-medium text-on-surface">日本語</span>
            </button>
          </div>
        </div>

        {/* Theme Selection */}
        <div className="mb-8">
          <label className="text-xs font-mono uppercase tracking-wider text-on-surface-variant mb-3 block">
            {t.interfaceTheme}
          </label>
          <div className="grid grid-cols-3 gap-3">
            {THEME_BUTTONS.map(({ key, labelKey }) => (
              <button
                key={key}
                onClick={() => handleThemeSelect(key)}
                className={`p-3 rounded-lg border-2 transition-all ${
                  theme === key
                    ? 'border-primary bg-primary/10'
                    : 'border-outline-variant/20 hover:border-outline-variant'
                }`}
              >
                <div
                  className={`h-8 w-full rounded mb-2 flex items-center justify-center border border-outline-variant/20 ${
                    key === 'dark' ? 'bg-[#0a0e14]' :
                    key === 'light' ? 'bg-[#f8f9ff]' :
                    'bg-gradient-to-r from-[#0a0e14] to-[#f8f9ff]'
                  }`}
                >
                  {key === 'system' && (
                    <span className="material-symbols-outlined text-xs text-on-surface">computer</span>
                  )}
                </div>
                <span className="text-xs text-on-surface">{t[labelKey]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Continue Button */}
        <button
          onClick={handleContinue}
          className="w-full py-3 rounded-lg bg-primary text-on-primary font-bold text-sm uppercase tracking-wide hover:opacity-90 transition-opacity"
        >
          {t.continue}
        </button>
      </div>
    </div>
  );
});
