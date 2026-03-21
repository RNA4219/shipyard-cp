import { useLanguage, useTranslation } from '../../contexts/LanguageContext';

export function LanguageSelector() {
  const { language, setLanguage } = useLanguage();
  const t = useTranslation();

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-mono uppercase tracking-wider text-on-surface-variant">
        {t.language}
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setLanguage('en')}
          className={`p-2 rounded-lg border-2 transition-all ${
            language === 'en'
              ? 'border-primary bg-primary/10'
              : 'border-outline-variant/20 hover:border-outline-variant'
          }`}
        >
          <span className="text-lg mb-1 block">🇺🇸</span>
          <span className="text-xs font-medium text-on-surface">English</span>
        </button>
        <button
          onClick={() => setLanguage('ja')}
          className={`p-2 rounded-lg border-2 transition-all ${
            language === 'ja'
              ? 'border-primary bg-primary/10'
              : 'border-outline-variant/20 hover:border-outline-variant'
          }`}
        >
          <span className="text-lg mb-1 block">🇯🇵</span>
          <span className="text-xs font-medium text-on-surface">日本語</span>
        </button>
      </div>
    </div>
  );
}