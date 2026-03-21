// Disable LiteLLM mock for this test file - we test the actual behavior with mocked fetch
process.env.LITELLM_MOCK = 'false';

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LiteLLMConnector, type LiteLLMConfig } from '../src/domain/litellm/index.js';

describe('LiteLLMConnector', () => {
  let connector: LiteLLMConnector;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    const config: LiteLLMConfig = {
      baseUrl: 'http://localhost:4000',
      apiKey: 'test-api-key',
      defaultModel: 'gpt-4o-mini',
      modelAliases: {
        'fast': 'gpt-4o-mini',
        'smart': 'gpt-4o',
      },
      fallbackModels: ['gpt-3.5-turbo'],
      timeout: 30000,
      enableFallback: true,
    };

    connector = new LiteLLMConnector(config);
  });

  describe('constructor', () => {
    it('should create connector with minimal config', () => {
      const minimal = new LiteLLMConnector({
        baseUrl: 'http://localhost:4000',
      });
      expect(minimal).toBeDefined();
    });

    it('should use default values for optional config', () => {
      const minimal = new LiteLLMConnector({
        baseUrl: 'http://localhost:4000',
      });
      const stats = minimal.getUsageStats();
      expect(stats.total_requests).toBe(0);
    });
  });

  describe('chatCompletion', () => {
    it('should make successful completion request', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4o-mini',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await connector.chatCompletion({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(result.id).toBe('chatcmpl-123');
      expect(result.choices[0].message.content).toBe('Hello!');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should resolve model alias', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4o-mini',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await connector.chatCompletion({
        model: 'fast', // Should resolve to gpt-4o-mini
        messages: [{ role: 'user', content: 'Hi' }],
      });

      const callArgs = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callArgs.model).toBe('gpt-4o-mini');
    });

    it('should include API key in headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'test',
          object: 'chat.completion',
          created: 0,
          model: 'gpt-4o-mini',
          choices: [],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }),
      });

      await connector.chatCompletion({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBe('Bearer test-api-key');
    });

    it('should try fallback on failure', async () => {
      // First call fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: 'Internal error' } }),
      });

      // Second call (fallback) succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'chatcmpl-fallback',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-3.5-turbo',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Fallback response' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      const result = await connector.chatCompletion({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(result.model).toBe('gpt-3.5-turbo');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw on non-retryable error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Unauthorized' } }),
      });

      await expect(
        connector.chatCompletion({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Hi' }],
        })
      ).rejects.toThrow();
    });
  });

  describe('listModels', () => {
    it('should list available models', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'gpt-4o', object: 'model' },
            { id: 'gpt-4o-mini', object: 'model' },
          ],
        }),
      });

      const models = await connector.listModels();

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('gpt-4o');
    });
  });

  describe('getModelRouting', () => {
    it('should return model routing config', () => {
      const routing = connector.getModelRouting();

      expect(routing.has('fast')).toBe(true);
      expect(routing.get('fast')?.targetModels).toContain('gpt-4o-mini');
      expect(routing.get('smart')?.targetModels).toContain('gpt-4o');
    });
  });

  describe('usage tracking', () => {
    it('should track successful usage', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-4o-mini',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        }),
      });

      await connector.chatCompletion({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      const log = connector.getUsageLog();
      expect(log).toHaveLength(1);
      expect(log[0].input_tokens).toBe(100);
      expect(log[0].output_tokens).toBe(50);
      expect(log[0].success).toBe(true);
    });

    it('should track failed requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: 'Internal error' } }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: 'Internal error' } }),
      });

      try {
        await connector.chatCompletion({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Hi' }],
        });
      } catch {
        // Expected
      }

      const log = connector.getUsageLog();
      expect(log.some(u => !u.success)).toBe(true);
    });

    it('should calculate usage stats', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-4o-mini',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        }),
      });

      await connector.chatCompletion({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Hi' }] });
      await connector.chatCompletion({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Hi' }] });

      const stats = connector.getUsageStats();

      expect(stats.total_requests).toBe(2);
      expect(stats.successful_requests).toBe(2);
      expect(stats.total_input_tokens).toBe(200);
      expect(stats.total_output_tokens).toBe(100);
    });

    it('should clear usage log', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-4o-mini',
          choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      await connector.chatCompletion({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Hi' }] });

      expect(connector.getUsageLog()).toHaveLength(1);

      connector.clearUsageLog();

      expect(connector.getUsageLog()).toHaveLength(0);
    });
  });

  describe('error parsing', () => {
    it('should parse auth error as non-retryable', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Unauthorized' } }),
      });

      await expect(
        connector.chatCompletion({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Hi' }] })
      ).rejects.toThrow();

      // Only one call because 401 is non-retryable
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should parse rate limit as retryable', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'Rate limit exceeded' } }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-3.5-turbo',
          choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      await connector.chatCompletion({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Hi' }] });

      // Should try fallback due to retryable error
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('task context', () => {
    it('should include task context in request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gpt-4o-mini',
          choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      });

      await connector.chatCompletion({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hi' }],
        task_context: {
          task_id: 'task_123',
          stage: 'plan',
          risk_level: 'low',
        },
      });

      const callArgs = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callArgs.task_context).toBeDefined();
      expect(callArgs.task_context.task_id).toBe('task_123');
    });
  });
});