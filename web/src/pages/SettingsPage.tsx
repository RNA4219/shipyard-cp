import { ThemeSelector } from '../components/settings/ThemeSelector';
import { LanguageSelector } from '../components/settings/LanguageSelector';
import { useTranslation } from '../contexts/LanguageContext';

export function SettingsPage() {
  const t = useTranslation();

  return (
    <div className="h-full overflow-y-auto custom-scrollbar p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <header className="mb-10">
          <h1 className="text-3xl font-extrabold tracking-tight text-on-surface mb-2">
            {t.settingsTitle}
          </h1>
          <p className="text-on-surface-variant text-sm">
            {t.settingsSubtitle}
          </p>
        </header>

        {/* Settings Sections */}
        <div className="space-y-12">
          {/* Language Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <h3 className="font-semibold text-on-surface text-base mb-1">{t.language}</h3>
              <p className="text-on-surface-variant text-xs">
                {t.languageDesc}
              </p>
            </div>
            <div className="md:col-span-2 bg-surface-container rounded-lg p-6 border border-outline-variant/10">
              <LanguageSelector />
            </div>
          </div>

          {/* Appearance Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-8 border-t border-outline-variant/10">
            <div>
              <h3 className="font-semibold text-on-surface text-base mb-1">{t.appearance}</h3>
              <p className="text-on-surface-variant text-xs">
                {t.appearanceDesc}
              </p>
            </div>
            <div className="md:col-span-2 bg-surface-container rounded-lg p-6 border border-outline-variant/10">
              <ThemeSelector />
            </div>
          </div>

          {/* Editor Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-8 border-t border-outline-variant/10">
            <div>
              <h3 className="font-semibold text-on-surface text-base mb-1">Editor</h3>
              <p className="text-on-surface-variant text-xs">
                Configure editor behavior and formatting.
              </p>
            </div>
            <div className="md:col-span-2 bg-surface-container rounded-lg p-6 border border-outline-variant/10 space-y-6">
              {/* Font Size */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-mono text-on-surface-variant uppercase tracking-wider">
                  Font Size
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    id="fontSize"
                    name="fontSize"
                    min="10"
                    max="24"
                    defaultValue="14"
                    className="w-full accent-primary h-1 bg-surface-container-highest rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="font-mono text-sm text-primary min-w-[3ch]">14</span>
                </div>
              </div>

              {/* Tab Size */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-mono text-on-surface-variant uppercase tracking-wider">
                  Tab Size
                </label>
                <div className="grid grid-cols-4 gap-2">
                  <button className="py-2 bg-surface-container-highest border border-outline-variant/20 rounded text-xs font-mono text-on-surface hover:bg-surface-variant transition-colors">
                    2
                  </button>
                  <button className="py-2 bg-primary/20 border border-primary/50 rounded text-xs font-mono text-primary font-bold">
                    4
                  </button>
                  <button className="py-2 bg-surface-container-highest border border-outline-variant/20 rounded text-xs font-mono text-on-surface hover:bg-surface-variant transition-colors">
                    8
                  </button>
                  <input
                    type="text"
                    id="customTabSize"
                    name="customTabSize"
                    placeholder="Custom"
                    className="py-2 bg-surface-container-highest border border-outline-variant/20 rounded text-xs font-mono text-on-surface text-center focus:ring-1 focus:ring-primary focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Notifications Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-8 border-t border-outline-variant/10">
            <div>
              <h3 className="font-semibold text-on-surface text-base mb-1">{t.notifications}</h3>
              <p className="text-on-surface-variant text-xs">
                {t.notificationsDesc}
              </p>
            </div>
            <div className="md:col-span-2 bg-surface-container rounded-lg p-6 border border-outline-variant/10 space-y-4">
              {/* Toggles */}
              <div className="flex items-center justify-between p-4 bg-surface-container-high rounded-lg">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-on-surface">{t.agentCompletion}</span>
                  <span className="text-[11px] text-on-surface-variant">{t.agentCompletionDesc}</span>
                </div>
                <button className="w-10 h-5 bg-primary/30 rounded-full relative border border-primary/50">
                  <div className="absolute right-0.5 top-0.5 w-3.5 h-3.5 bg-primary rounded-full" />
                </button>
              </div>
              <div className="flex items-center justify-between p-4 bg-surface-container-high rounded-lg">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-on-surface">{t.errorAlerts}</span>
                  <span className="text-[11px] text-on-surface-variant">{t.errorAlertsDesc}</span>
                </div>
                <button className="w-10 h-5 bg-primary/30 rounded-full relative border border-primary/50">
                  <div className="absolute right-0.5 top-0.5 w-3.5 h-3.5 bg-primary rounded-full" />
                </button>
              </div>
              <div className="flex items-center justify-between p-4 bg-surface-container-high rounded-lg">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-on-surface">{t.systemUpdates}</span>
                  <span className="text-[11px] text-on-surface-variant">{t.systemUpdatesDesc}</span>
                </div>
                <button className="w-10 h-5 bg-surface-container-highest rounded-full relative border border-outline-variant/20">
                  <div className="absolute left-0.5 top-0.5 w-3.5 h-3.5 bg-on-surface-variant/40 rounded-full" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-16 flex items-center justify-end gap-4 pb-12">
          <button className="px-6 py-2.5 text-xs font-mono uppercase tracking-widest text-on-surface-variant hover:text-on-surface transition-colors">
            {t.resetToDefaults}
          </button>
          <button className="px-8 py-2.5 rounded-md bg-gradient-to-br from-primary to-primary-container text-on-primary-fixed font-mono text-xs uppercase tracking-widest font-bold shadow-lg shadow-primary/20 active:opacity-80 transition-opacity">
            {t.saveChanges}
          </button>
        </footer>
      </div>
    </div>
  );
}