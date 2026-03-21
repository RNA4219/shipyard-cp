export const NOTIFICATION_SETTINGS_KEY = 'shipyard-notification-settings';

export interface NotificationSettings {
  agentCompletion: boolean;
  errorAlerts: boolean;
}

export const defaultNotificationSettings: NotificationSettings = {
  agentCompletion: true,
  errorAlerts: true,
};

export function loadNotificationSettings(): NotificationSettings {
  if (typeof window === 'undefined') return defaultNotificationSettings;

  try {
    const stored = localStorage.getItem(NOTIFICATION_SETTINGS_KEY);
    if (stored) {
      return { ...defaultNotificationSettings, ...JSON.parse(stored) };
    }
  } catch {
    // Ignore parse errors and fall back to defaults.
  }

  return defaultNotificationSettings;
}

export function saveNotificationSettings(settings: NotificationSettings): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(settings));
}
