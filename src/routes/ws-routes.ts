import type { FastifyInstance } from 'fastify';
import type WebSocket from 'ws';
import type { RawData } from 'ws';
import type { ControlPlaneStore } from '../store/control-plane-store.js';

interface WebSocketMessage {
  type: 'init' | 'task_update' | 'state_transition' | 'run_update' | 'subscribe' | 'ping' | 'pong';
  payload?: unknown;
  taskIds?: string[];
  events?: string[];
}

/**
 * Type guard to validate WebSocket message structure
 */
function isValidWebSocketMessage(data: unknown): data is WebSocketMessage {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as Record<string, unknown>;
  if (typeof msg.type !== 'string') return false;
  const validTypes = ['init', 'task_update', 'state_transition', 'run_update', 'subscribe', 'ping', 'pong'];
  if (!validTypes.includes(msg.type)) return false;
  if (msg.taskIds !== undefined && !Array.isArray(msg.taskIds)) return false;
  if (msg.events !== undefined && !Array.isArray(msg.events)) return false;
  return true;
}

interface Subscription {
  connection: WebSocket;
  filters: {
    taskIds?: Set<string>;
    events?: Set<string>;
  };
}

/**
 * Register WebSocket routes for real-time updates.
 * Uses @fastify/websocket for WebSocket support.
 */
export async function registerWebSocketRoutes(
  app: FastifyInstance,
  _store: ControlPlaneStore,
): Promise<void> {
  // Track active subscriptions
  const subscriptions = new Map<WebSocket, Subscription>();

  /**
   * Broadcast message to all connected clients
   */
  function broadcast(message: WebSocketMessage, exclude?: WebSocket): void {
    const payload = JSON.stringify(message);
    for (const ws of subscriptions.keys()) {
      if (ws !== exclude && ws.readyState === 1) { // WebSocket.OPEN
        try {
          ws.send(payload);
        } catch {
          // Connection might have closed
          subscriptions.delete(ws);
        }
      }
    }
  }

  /**
   * Broadcast task update to subscribed clients
   */
  function broadcastTaskUpdate(taskId: string, update: Record<string, unknown>): void {
    broadcast({
      type: 'task_update',
      payload: { task_id: taskId, ...update },
    });
  }

  /**
   * Broadcast state transition to subscribed clients
   */
  function broadcastStateTransition(
    taskId: string,
    fromState: string,
    toState: string,
    reason: string,
  ): void {
    broadcast({
      type: 'state_transition',
      payload: { task_id: taskId, from_state: fromState, to_state: toState, reason },
    });
  }

  // WebSocket endpoint for task subscriptions
  app.get('/ws', { websocket: true }, (connection: WebSocket) => {
    // connection is the WebSocket instance directly in @fastify/websocket

    // Initialize subscription with no filters (all events)
    subscriptions.set(connection, {
      connection,
      filters: {},
    });

    // Send initial state
    connection.on('message', (rawMessage: RawData) => {
      try {
        const parsed = JSON.parse(rawMessage.toString());
        if (!isValidWebSocketMessage(parsed)) {
          return; // Ignore invalid messages
        }
        const message = parsed;

        if (message.type === 'subscribe') {
          const sub = subscriptions.get(connection);
          if (sub) {
            if (message.taskIds) {
              sub.filters.taskIds = new Set(message.taskIds);
            }
            if (message.events) {
              sub.filters.events = new Set(message.events);
            }
          }
          // Send current tasks on subscribe
          connection.send(JSON.stringify({
            type: 'init',
            payload: { message: 'subscribed' },
          }));
        } else if (message.type === 'ping') {
          connection.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {
        // Ignore malformed messages
      }
    });

    // Handle close
    connection.on('close', () => {
      subscriptions.delete(connection);
    });

    // Handle errors
    connection.on('error', () => {
      subscriptions.delete(connection);
    });
  });

  // Store reference to broadcast functions
  app.decorate('wsBroadcast', broadcast);
  app.decorate('wsBroadcastTaskUpdate', broadcastTaskUpdate);
  app.decorate('wsBroadcastStateTransition', broadcastStateTransition);
}

// Type augmentation for Fastify instance
declare module 'fastify' {
  interface FastifyInstance {
    wsBroadcast?: (message: WebSocketMessage, exclude?: WebSocket) => void;
    wsBroadcastTaskUpdate?: (taskId: string, update: Record<string, unknown>) => void;
    wsBroadcastStateTransition?: (
      taskId: string,
      fromState: string,
      toState: string,
      reason: string,
    ) => void;
  }
}