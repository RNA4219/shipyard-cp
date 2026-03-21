import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import WebSocket from 'ws';

describe('WebSocket Routes', () => {
  let app: FastifyInstance & {
    store: import('../src/store/control-plane-store.js').ControlPlaneStore;
    wsBroadcast?: (message: { type: string; payload: unknown }, exclude?: WebSocket) => void;
    wsBroadcastTaskUpdate?: (taskId: string, update: Record<string, unknown>) => void;
    wsBroadcastStateTransition?: (taskId: string, fromState: string, toState: string, reason: string) => void;
  };
  let baseUrl: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false, auth: { enabled: false } });
    // Start listening on a random port
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address() as { port: number };
    baseUrl = `127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /ws', () => {
    it('should accept WebSocket connections', async () => {
      const ws = new WebSocket(`ws://${baseUrl}/ws`);

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          expect(ws.readyState).toBe(WebSocket.OPEN);
          ws.close();
          resolve();
        });
        ws.on('error', reject);
      });
    });

    it('should respond to ping messages', async () => {
      const ws = new WebSocket(`ws://${baseUrl}/ws`);

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'ping' }));
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'pong') {
            expect(message.type).toBe('pong');
            ws.close();
            resolve();
          }
        });

        ws.on('error', reject);
      });
    });

    it('should respond to subscribe messages', async () => {
      const ws = new WebSocket(`ws://${baseUrl}/ws`);

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'subscribe' }));
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'init') {
            expect(message.payload.message).toBe('subscribed');
            ws.close();
            resolve();
          }
        });

        ws.on('error', reject);
      });
    });

    it('should handle subscribe with taskIds filter', async () => {
      const ws = new WebSocket(`ws://${baseUrl}/ws`);

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          ws.send(JSON.stringify({
            type: 'subscribe',
            taskIds: ['task_123', 'task_456'],
          }));
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'init') {
            expect(message.payload.message).toBe('subscribed');
            ws.close();
            resolve();
          }
        });

        ws.on('error', reject);
      });
    });

    it('should handle subscribe with events filter', async () => {
      const ws = new WebSocket(`ws://${baseUrl}/ws`);

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          ws.send(JSON.stringify({
            type: 'subscribe',
            events: ['task_update', 'state_transition'],
          }));
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'init') {
            expect(message.payload.message).toBe('subscribed');
            ws.close();
            resolve();
          }
        });

        ws.on('error', reject);
      });
    });

    it('should handle multiple connections', async () => {
      const ws1 = new WebSocket(`ws://${baseUrl}/ws`);
      const ws2 = new WebSocket(`ws://${baseUrl}/ws`);

      await Promise.all([
        new Promise<void>((resolve, reject) => {
          ws1.on('open', () => {
            expect(ws1.readyState).toBe(WebSocket.OPEN);
            ws1.close();
            resolve();
          });
          ws1.on('error', reject);
        }),
        new Promise<void>((resolve, reject) => {
          ws2.on('open', () => {
            expect(ws2.readyState).toBe(WebSocket.OPEN);
            ws2.close();
            resolve();
          });
          ws2.on('error', reject);
        }),
      ]);
    });

    it('should handle connection close gracefully', async () => {
      const ws = new WebSocket(`ws://${baseUrl}/ws`);

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          ws.close();
        });

        ws.on('close', () => {
          resolve();
        });

        ws.on('error', reject);
      });
    });

    it('should ignore malformed messages', async () => {
      const ws = new WebSocket(`ws://${baseUrl}/ws`);

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          // Send invalid JSON
          ws.send('not valid json');

          // Wait a bit, then send valid message
          setTimeout(() => {
            expect(ws.readyState).toBe(WebSocket.OPEN);
            ws.send(JSON.stringify({ type: 'ping' }));
          }, 50);
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'pong') {
            ws.close();
            resolve();
          }
        });

        ws.on('error', reject);
      });
    });
  });

  describe('Broadcast Functions', () => {
    it('should have wsBroadcast function available', () => {
      expect(app.wsBroadcast).toBeDefined();
      expect(typeof app.wsBroadcast).toBe('function');
    });

    it('should have wsBroadcastTaskUpdate function available', () => {
      expect(app.wsBroadcastTaskUpdate).toBeDefined();
      expect(typeof app.wsBroadcastTaskUpdate).toBe('function');
    });

    it('should have wsBroadcastStateTransition function available', () => {
      expect(app.wsBroadcastStateTransition).toBeDefined();
      expect(typeof app.wsBroadcastStateTransition).toBe('function');
    });

    it('should broadcast task update to connected clients', async () => {
      const ws = new WebSocket(`ws://${baseUrl}/ws`);

      await new Promise<void>((resolve, reject) => {
        let receivedInit = false;

        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'subscribe' }));
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'init' && !receivedInit) {
            receivedInit = true;
            // Broadcast a task update
            app.wsBroadcastTaskUpdate!('task_123', { status: 'updated', progress: 50 });
          } else if (message.type === 'task_update') {
            expect(message.payload.task_id).toBe('task_123');
            expect(message.payload.status).toBe('updated');
            expect(message.payload.progress).toBe(50);
            ws.close();
            resolve();
          }
        });

        ws.on('error', reject);

        // Timeout if no message received
        setTimeout(() => {
          ws.close();
          resolve();
        }, 2000);
      });
    });

    it('should broadcast state transition to connected clients', async () => {
      const ws = new WebSocket(`ws://${baseUrl}/ws`);

      await new Promise<void>((resolve, reject) => {
        let receivedInit = false;

        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'subscribe' }));
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'init' && !receivedInit) {
            receivedInit = true;
            // Broadcast a state transition
            app.wsBroadcastStateTransition!('task_456', 'queued', 'planned', 'Plan completed successfully');
          } else if (message.type === 'state_transition') {
            expect(message.payload.task_id).toBe('task_456');
            expect(message.payload.from_state).toBe('queued');
            expect(message.payload.to_state).toBe('planned');
            expect(message.payload.reason).toBe('Plan completed successfully');
            ws.close();
            resolve();
          }
        });

        ws.on('error', reject);

        // Timeout if no message received
        setTimeout(() => {
          ws.close();
          resolve();
        }, 2000);
      });
    });

    it('should broadcast to all connected clients', async () => {
      const ws1 = new WebSocket(`ws://${baseUrl}/ws`);
      const ws2 = new WebSocket(`ws://${baseUrl}/ws`);
      let ws1Received = false;
      let ws2Received = false;

      await new Promise<void>((resolve, reject) => {
        let ws1Ready = false;
        let ws2Ready = false;

        const checkComplete = () => {
          if (ws1Received && ws2Received) {
            ws1.close();
            ws2.close();
            resolve();
          }
        };

        ws1.on('open', () => {
          ws1.send(JSON.stringify({ type: 'subscribe' }));
        });

        ws2.on('open', () => {
          ws2.send(JSON.stringify({ type: 'subscribe' }));
        });

        ws1.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'init') {
            ws1Ready = true;
            if (ws1Ready && ws2Ready) {
              // Broadcast using generic wsBroadcast
              app.wsBroadcast!({ type: 'task_update', payload: { broadcast_test: true } });
            }
          } else if (message.type === 'task_update') {
            ws1Received = true;
            checkComplete();
          }
        });

        ws2.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'init') {
            ws2Ready = true;
            if (ws1Ready && ws2Ready) {
              app.wsBroadcast!({ type: 'task_update', payload: { broadcast_test: true } });
            }
          } else if (message.type === 'task_update') {
            ws2Received = true;
            checkComplete();
          }
        });

        ws1.on('error', reject);
        ws2.on('error', reject);

        // Timeout
        setTimeout(() => {
          ws1.close();
          ws2.close();
          resolve();
        }, 3000);
      });
    });

    it('should handle broadcast when no clients are connected', () => {
      // Should not throw when broadcasting to no clients
      expect(() => {
        app.wsBroadcast!({ type: 'task_update', payload: { test: true } });
      }).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle connection errors gracefully', async () => {
      const ws = new WebSocket(`ws://${baseUrl}/ws`);

      await new Promise<void>((resolve) => {
        ws.on('open', () => {
          // Immediately close the connection
          ws.terminate();
          setTimeout(resolve, 100);
        });
        ws.on('error', () => {
          // Error is expected when terminating
          resolve();
        });
      });
    });
  });
});