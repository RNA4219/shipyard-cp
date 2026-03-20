import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import WebSocket from 'ws';

describe('WebSocket Routes', () => {
  let app: FastifyInstance;
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
});