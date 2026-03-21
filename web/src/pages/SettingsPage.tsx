import { useState } from 'react';
import { ThemeSelector } from '../components/settings/ThemeSelector';
import { LanguageSelector } from '../components/settings/LanguageSelector';
import { useTranslation } from '../contexts/LanguageContext';
import {
  defaultNotificationSettings,
  loadNotificationSettings,
  saveNotificationSettings,
  type NotificationSettings,
} from '../domain/notificationSettings';

export function SettingsPage() {
  const t = useTranslation();

  // Notification settings state with persistence
  const [notifications, setNotifications] = useState<NotificationSettings>(() => loadNotificationSettings());
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const toggleNotification = (key: keyof typeof notifications) => {
    setNotifications((prev) => {
      const updated = { ...prev, [key]: !prev[key] };
      saveNotificationSettings(updated);
      return updated;
    });
    // Show instant feedback for this setting
    setSavedKey(key);
    setTimeout(() => setSavedKey(null), 1500);
  };

  const handleReset = () => {
    const resetSettings = defaultNotificationSettings;
    setNotifications(resetSettings);
    saveNotificationSettings(resetSettings);
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
                <div className="flex items-center gap-1">
                  {savedKey === 'agentCompletion' && (
                    <span className="text-tertiary text-[9px] font-mono">✓</span>
                  )}
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
              </div>
              <div className="flex items-center justify-between p-2 bg-surface-container-high rounded-lg">
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-on-surface">{t.errorAlerts}</span>
                  <span className="text-[9px] text-on-surface-variant">{t.errorAlertsDesc}</span>
                </div>
                <div className="flex items-center gap-1">
                  {savedKey === 'errorAlerts' && (
                    <span className="text-tertiary text-[9px] font-mono">✓</span>
                  )}
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
        </div>

        {/* Footer */}
        <footer className="mt-8 flex items-center justify-end gap-2 pb-6">
          <button
            onClick={handleReset}
            className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-on-surface-variant hover:text-on-surface transition-colors"
          >
            {t.resetToDefaults}
          </button>
        </footer>
      </div>
    </div>
  );
}
