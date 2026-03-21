import { useEffect, useRef, useState } from 'react';
import { useNotifications } from '../contexts/NotificationContext';
import { useTranslation } from '../contexts/LanguageContext';
import { loadNotificationSettings } from '../domain/notificationSettings';
import type { WSMessage, TaskState } from '../types';

// In development, use relative URL to go through Vite proxy
// In production, use the configured URL
const getWsUrl = () => {
  const configuredUrl = import.meta.env.VITE_WS_URL;
  if (configuredUrl) {
    return configuredUrl;
  }
  // In browser, construct WebSocket URL from current location
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
  }
  return '';
};

const WS_URL = getWsUrl();
const WS_ENABLED = import.meta.env.VITE_WS_ENABLED !== 'false' && WS_URL !== '';

interface UseWebSocketOptions {
  onMessage?: (data: WSMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
  reconnect?: boolean;
  reconnectInterval?: number;
  enabled?: boolean;
}

interface TaskUpdatePayload {
  task_id: string;
  title?: string;
  state?: TaskState;
  [key: string]: unknown;
}

interface StateTransitionPayload {
  task_id: string;
  title?: string;
  from_state: TaskState;
  to_state: TaskState;
  reason?: string;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    onMessage,
    onOpen,
    onClose,
    onError,
    reconnect = true,
    reconnectInterval = 3000,
    enabled = true,
  } = options;

  const { addNotification } = useNotifications();
  const t = useTranslation();

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Store options in refs
  const optionsRef = useRef({
    onMessage,
    onOpen,
    onClose,
    onError,
    reconnect,
    reconnectInterval,
    enabled,
  });

  // Keep refs updated
  useEffect(() => {
    optionsRef.current = {
      onMessage,
      onOpen,
      onClose,
      onError,
      reconnect,
      reconnectInterval,
      enabled,
    };
  });

  // Helper function to handle notifications based on message type
  const handleNotification = (data: WSMessage) => {
    const notificationSettings = loadNotificationSettings();

    switch (data.type) {
      case 'task_update': {
        const payload = data.payload as TaskUpdatePayload;
        if (payload.state) {
          // Check for completion (published)
          if (payload.state === 'published' && notificationSettings.agentCompletion) {
            addNotification({
              type: 'task_completed',
              taskId: payload.task_id,
              taskTitle: payload.title,
              message: t.notificationTaskCompleted,
            });
          }
          // Check for failure states
          else if ((payload.state === 'failed' || payload.state === 'blocked') && notificationSettings.errorAlerts) {
            addNotification({
              type: 'task_failed',
              taskId: payload.task_id,
              taskTitle: payload.title,
              message: payload.state === 'failed'
                ? t.notificationTaskFailed
                : t.notificationTaskBlocked,
            });
          }
        }
        break;
      }

      case 'state_transition': {
        const payload = data.payload as StateTransitionPayload;
        if (!notificationSettings.agentCompletion) {
          break;
        }
        addNotification({
          type: 'state_transition',
          taskId: payload.task_id,
          taskTitle: payload.title,
          fromState: payload.from_state,
          toState: payload.to_state,
          message: t.notificationStateTransition,
        });
        break;
      }

      default:
        // Ignore other message types
        break;
    }
  };

  const connect = () => {
    // Skip if WebSocket is disabled or no URL configured
    if (!WS_ENABLED || !optionsRef.current.enabled) {
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      const ws = new WebSocket(`${WS_URL}/ws`);

      ws.onopen = () => {
        setIsConnected(true);
        setError(null);
        optionsRef.current.onOpen?.();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WSMessage;
          optionsRef.current.onMessage?.(data);

          // Handle notifications based on message type
          handleNotification(data);
        } catch {
          console.error('Failed to parse WebSocket message');
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        optionsRef.current.onClose?.();

        if (optionsRef.current.reconnect) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, optionsRef.current.reconnectInterval);
        }
      };

      ws.onerror = () => {
        // Suppress WebSocket errors in development/mock mode
        setError('WebSocket connection failed');
      };

      wsRef.current = ws;
    } catch {
      setError('Failed to connect to WebSocket');
    }
  };

  const disconnect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    wsRef.current?.close();
    wsRef.current = null;
    setIsConnected(false);
  };

  const send = (data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
      return true;
    }
    return false;
  };

  const subscribe = (taskIds?: string[], events?: string[]) => {
    return send({ type: 'subscribe', taskIds, events });
  };

  const ping = () => {
    return send({ type: 'ping' });
  };

  useEffect(() => {
    connect();
    return () => disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    isConnected,
    error,
    send,
    subscribe,
    ping,
    disconnect,
    reconnect: connect,
  };
}
