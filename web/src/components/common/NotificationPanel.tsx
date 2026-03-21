import { useRef, useEffect } from 'react';
import { useNotifications } from '../../contexts/NotificationContext';
import { useTranslation } from '../../contexts/LanguageContext';
import type { Notification, NotificationType } from '../../contexts/NotificationContext';

interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// Notification type configurations
const notificationConfigs: Record<NotificationType, {
  icon: string;
  colorClass: string;
  bgColorClass: string;
}> = {
  task_completed: {
    icon: 'check_circle',
    colorClass: 'text-tertiary',
    bgColorClass: 'bg-tertiary/10',
  },
  task_failed: {
    icon: 'error',
    colorClass: 'text-error',
    bgColorClass: 'bg-error/10',
  },
  state_transition: {
    icon: 'sync',
    colorClass: 'text-primary',
    bgColorClass: 'bg-primary/10',
  },
};

// Time ago formatter
function formatTimeAgo(date: Date, t: Record<string, string>): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return t.justNow;
  if (diffMins < 60) return `${diffMins}${t.minAgo}`;
  if (diffHours < 24) return `${diffHours}${t.hrAgo}`;
  return `${diffDays}${t.dayAgo}`;
}

function NotificationItem({
  notification,
  onMarkAsRead,
  onClear,
}: {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onClear: (id: string) => void;
}) {
  const t = useTranslation();
  const config = notificationConfigs[notification.type];
  const itemRef = useRef<HTMLDivElement>(null);

  // Auto mark as read when viewed
  useEffect(() => {
    if (!notification.read && itemRef.current) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            // Delay marking as read to give user time to see the "unread" indicator
            const timer = setTimeout(() => {
              onMarkAsRead(notification.id);
            }, 1000);
            return () => clearTimeout(timer);
          }
        },
        { threshold: 0.5 }
      );

      observer.observe(itemRef.current);
      return () => observer.disconnect();
    }
  }, [notification.read, notification.id, onMarkAsRead]);

  return (
    <div
      ref={itemRef}
      className={`
        relative px-3 py-2 hover:bg-surface-container-high transition-colors cursor-pointer
        ${!notification.read ? 'bg-surface-container/50' : ''}
      `}
      onClick={() => onMarkAsRead(notification.id)}
    >
      {/* Unread indicator */}
      {!notification.read && (
        <div className="absolute left-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-primary" />
      )}

      <div className="flex items-start gap-2">
        {/* Icon */}
        <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${config.bgColorClass}`}>
          <span className={`material-symbols-outlined text-sm ${config.colorClass}`}>
            {config.icon}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-on-surface font-medium truncate">
            {notification.message}
          </p>
          <p className="text-[10px] text-on-surface-variant mt-0.5">
            {notification.taskTitle || notification.taskId}
          </p>
          <p className="text-[10px] text-on-surface-variant/70 mt-0.5">
            {formatTimeAgo(notification.timestamp, t)}
          </p>
        </div>

        {/* Clear button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClear(notification.id);
          }}
          className="flex-shrink-0 p-0.5 rounded hover:bg-surface-container-high transition-colors"
          title={t.clear}
        >
          <span className="material-symbols-outlined text-xs text-on-surface-variant">
            close
          </span>
        </button>
      </div>
    </div>
  );
}

export function NotificationPanel({ isOpen, onClose }: NotificationPanelProps) {
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    clearNotification,
    clearAllNotifications,
  } = useNotifications();
  const t = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus trap
  useEffect(() => {
    if (isOpen && panelRef.current) {
      const focusableElements = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusableElements.length > 0) {
        focusableElements[0].focus();
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full mt-1 w-80 max-h-96 bg-surface-container-high rounded-lg shadow-lg border border-outline-variant/20 overflow-hidden z-50"
      role="dialog"
      aria-label={t.notifications}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-outline-variant/20 bg-surface-container-high">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-on-surface">
            {t.notifications}
          </span>
          {unreadCount > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-mono bg-primary text-on-primary rounded-full">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="px-2 py-1 text-[10px] font-mono text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded transition-colors"
            >
              {t.markAllRead}
            </button>
          )}
          <button
            onClick={clearAllNotifications}
            className="px-2 py-1 text-[10px] font-mono text-error hover:bg-error/10 rounded transition-colors"
            title={t.clearAll}
          >
            {t.clearAll}
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-surface-container rounded transition-colors"
            aria-label={t.close}
          >
            <span className="material-symbols-outlined text-sm text-on-surface-variant">
              close
            </span>
          </button>
        </div>
      </div>

      {/* Notification List */}
      <div className="overflow-y-auto max-h-72">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4">
            <span className="material-symbols-outlined text-3xl text-on-surface-variant/50 mb-2">
              notifications_none
            </span>
            <p className="text-xs text-on-surface-variant text-center">
              {t.noNotifications}
            </p>
          </div>
        ) : (
          notifications.map(notification => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onMarkAsRead={markAsRead}
              onClear={clearNotification}
            />
          ))
        )}
      </div>
    </div>
  );
}