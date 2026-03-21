import { useState } from 'react';
import { ThemeSelector } from '../components/settings/ThemeSelector';
import { LanguageSelector } from '../components/settings/LanguageSelector';
import { useTranslation } from '../contexts/LanguageContext';

export function SettingsPage() {
  const t = useTranslation();

  // Editor settings state
  const [fontSize, setFontSize] = useState(14);
  const [tabSize, setTabSize] = useState(4);
  const [customTabSize, setCustomTabSize] = useState('');

  // Notification settings state
  const [notifications, setNotifications] = useState({
    agentCompletion: true,
    errorAlerts: true,
    systemUpdates: false,
  });

  const toggleNotification = (key: keyof typeof notifications) => {
    setNotifications((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = () => {
    // Save settings (for now just log)
    console.log('Saving settings:', { fontSize, tabSize, notifications });
    alert(t.settingsSaved || 'Settings saved!');
  };

  const handleReset = () => {
    setFontSize(14);
    setTabSize(4);
    setCustomTabSize('');
    setNotifications({
      agentCompletion: true,
      errorAlerts: true,
      systemUpdates: false,
    });
  };

  const handleTabSizeClick = (size: number) => {
    setTabSize(size);
    setCustomTabSize('');
  };

  return (
    <div className="h-full overflow-y-auto custom-scrollbar p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <header className="mb-4">
          <h1 className="text-lg font-extrabold tracking-tight text-on-surface mb-1">
            {t.settingsTitle}
          </h1>
          <p className="text-on-surface-variant text-xs">
            {t.settingsSubtitle}
          </p>
        </header>

        {/* Settings Sections */}
        <div className="space-y-6">
          {/* Language Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <h3 className="font-semibold text-on-surface text-sm mb-0.5">{t.language}</h3>
              <p className="text-on-surface-variant text-[10px]">
                {t.languageDesc}
              </p>
            </div>
            <div className="md:col-span-2 bg-surface-container rounded-lg p-3 border border-outline-variant/10">
              <LanguageSelector />
            </div>
          </div>

          {/* Appearance Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-outline-variant/10">
            <div>
              <h3 className="font-semibold text-on-surface text-sm mb-0.5">{t.appearance}</h3>
              <p className="text-on-surface-variant text-[10px]">
                {t.appearanceDesc}
              </p>
            </div>
            <div className="md:col-span-2 bg-surface-container rounded-lg p-3 border border-outline-variant/10">
              <ThemeSelector />
            </div>
          </div>

          {/* Editor Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-outline-variant/10">
            <div>
              <h3 className="font-semibold text-on-surface text-sm mb-0.5">Editor</h3>
              <p className="text-on-surface-variant text-[10px]">
                Configure editor behavior and formatting.
              </p>
            </div>
            <div className="md:col-span-2 bg-surface-container rounded-lg p-3 border border-outline-variant/10 space-y-3">
              {/* Font Size */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">
                  Font Size
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    id="fontSize"
                    name="fontSize"
                    min="10"
                    max="24"
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    className="w-full accent-primary h-0.5 bg-surface-container-highest rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="font-mono text-xs text-primary min-w-[3ch]">{fontSize}</span>
                </div>
              </div>

              {/* Tab Size */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono text-on-surface-variant uppercase tracking-wider">
                  Tab Size
                </label>
                <div className="grid grid-cols-4 gap-1">
                  <button
                    onClick={() => handleTabSizeClick(2)}
                    className={`py-1 rounded text-[10px] font-mono transition-colors ${
                      tabSize === 2
                        ? 'bg-primary/20 border border-primary/50 text-primary font-bold'
                        : 'bg-surface-container-highest border border-outline-variant/20 text-on-surface hover:bg-surface-variant'
                    }`}
                  >
                    2
                  </button>
                  <button
                    onClick={() => handleTabSizeClick(4)}
                    className={`py-1 rounded text-[10px] font-mono transition-colors ${
                      tabSize === 4
                        ? 'bg-primary/20 border border-primary/50 text-primary font-bold'
                        : 'bg-surface-container-highest border border-outline-variant/20 text-on-surface hover:bg-surface-variant'
                    }`}
                  >
                    4
                  </button>
                  <button
                    onClick={() => handleTabSizeClick(8)}
                    className={`py-1 rounded text-[10px] font-mono transition-colors ${
                      tabSize === 8
                        ? 'bg-primary/20 border border-primary/50 text-primary font-bold'
                        : 'bg-surface-container-highest border border-outline-variant/20 text-on-surface hover:bg-surface-variant'
                    }`}
                  >
                    8
                  </button>
                  <input
                    type="text"
                    id="customTabSize"
                    name="customTabSize"
                    placeholder="Custom"
                    value={customTabSize}
                    onChange={(e) => {
                      setCustomTabSize(e.target.value);
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val) && val > 0) setTabSize(val);
                    }}
                    className="py-1 bg-surface-container-highest border border-outline-variant/20 rounded text-[10px] font-mono text-on-surface text-center focus:ring-1 focus:ring-primary focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Notifications Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-outline-variant/10">
            <div>
              <h3 className="font-semibold text-on-surface text-sm mb-0.5">{t.notifications}</h3>
              <p className="text-on-surface-variant text-[10px]">
                {t.notificationsDesc}
              </p>
            </div>
            <div className="md:col-span-2 bg-surface-container rounded-lg p-3 border border-outline-variant/10 space-y-2">
              {/* Toggles */}
              <div className="flex items-center justify-between p-2 bg-surface-container-high rounded-lg">
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-on-surface">{t.agentCompletion}</span>
                  <span className="text-[9px] text-on-surface-variant">{t.agentCompletionDesc}</span>
                </div>
                <button
                  onClick={() => toggleNotification('agentCompletion')}
                  className={`w-6 h-3 rounded-full relative border transition-colors ${
                    notifications.agentCompletion
                      ? 'bg-primary/30 border-primary/50'
                      : 'bg-surface-container border-outline'
                  }`}
                >
                  <div className={`absolute top-0.5 w-2 h-2 rounded-full transition-all ${
                    notifications.agentCompletion
                      ? 'right-0.5 bg-primary'
                      : 'left-0.5 bg-on-surface-variant'
                  }`} />
                </button>
              </div>
              <div className="flex items-center justify-between p-2 bg-surface-container-high rounded-lg">
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-on-surface">{t.errorAlerts}</span>
                  <span className="text-[9px] text-on-surface-variant">{t.errorAlertsDesc}</span>
                </div>
                <button
                  onClick={() => toggleNotification('errorAlerts')}
                  className={`w-6 h-3 rounded-full relative border transition-colors ${
                    notifications.errorAlerts
                      ? 'bg-primary/30 border-primary/50'
                      : 'bg-surface-container border-outline'
                  }`}
                >
                  <div className={`absolute top-0.5 w-2 h-2 rounded-full transition-all ${
                    notifications.errorAlerts
                      ? 'right-0.5 bg-primary'
                      : 'left-0.5 bg-on-surface-variant'
                  }`} />
                </button>
              </div>
              <div className="flex items-center justify-between p-2 bg-surface-container-high rounded-lg">
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-on-surface">{t.systemUpdates}</span>
                  <span className="text-[9px] text-on-surface-variant">{t.systemUpdatesDesc}</span>
                </div>
                <button
                  onClick={() => toggleNotification('systemUpdates')}
                  className={`w-6 h-3 rounded-full relative border transition-colors ${
                    notifications.systemUpdates
                      ? 'bg-primary/30 border-primary/50'
                      : 'bg-surface-container border-outline'
                  }`}
                >
                  <div className={`absolute top-0.5 w-2 h-2 rounded-full transition-all ${
                    notifications.systemUpdates
                      ? 'right-0.5 bg-primary'
                      : 'left-0.5 bg-on-surface-variant'
                  }`} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-8 flex items-center justify-end gap-2 pb-6">
          <button
            onClick={handleReset}
            className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-on-surface-variant hover:text-on-surface transition-colors"
          >
            {t.resetToDefaults}
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-1.5 rounded-md bg-gradient-to-br from-primary to-primary-container text-on-primary-fixed font-mono text-[10px] uppercase tracking-widest font-bold shadow-lg shadow-primary/20 active:opacity-80 transition-opacity"
          >
            {t.saveChanges}
          </button>
        </footer>
      </div>
    </div>
  );
}