import { useState, useEffect } from 'react';
import { ThemeSelector } from '../components/settings/ThemeSelector';
import { LanguageSelector } from '../components/settings/LanguageSelector';
import { useTranslation } from '../contexts/LanguageContext';
import { useNotifications } from '../contexts/NotificationContext';

const NOTIFICATION_SETTINGS_KEY = 'shipyard-notification-settings';

interface NotificationSettings {
  agentCompletion: boolean;
  errorAlerts: boolean;
}

const defaultSettings: NotificationSettings = {
  agentCompletion: true,
  errorAlerts: true,
};

function loadSettings(): NotificationSettings {
  if (typeof window === 'undefined') return defaultSettings;
  try {
    const stored = localStorage.getItem(NOTIFICATION_SETTINGS_KEY);
    if (stored) {
      return { ...defaultSettings, ...JSON.parse(stored) };
    }
  } catch {
    // Ignore parse errors
  }
  return defaultSettings;
}

function saveSettings(settings: NotificationSettings): void {
  localStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(settings));
}

export function SettingsPage() {
  const t = useTranslation();
  const { addNotification } = useNotifications();

  // Notification settings state with persistence
  const [notifications, setNotifications] = useState<NotificationSettings>(() => loadSettings());

  // Load settings on mount
  useEffect(() => {
    const stored = loadSettings();
    setNotifications(stored);
  }, []);

  const toggleNotification = (key: keyof typeof notifications) => {
    setNotifications((prev) => {
      const updated = { ...prev, [key]: !prev[key] };
      saveSettings(updated);
      return updated;
    });
  };

  const handleSave = () => {
    saveSettings(notifications);
    addNotification({
      type: 'success',
      title: t.settingsSaved || 'Settings saved!',
      message: t.settingsSaved || 'Settings saved!',
    });
  };

  const handleReset = () => {
    const resetSettings = defaultSettings;
    setNotifications(resetSettings);
    saveSettings(resetSettings);
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