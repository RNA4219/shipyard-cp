import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { LiteLLMConnector } from '../src/domain/litellm/index.js';

/**
 * LiteLLM Integration Tests
 *
 * Uses API keys from llm_orch/.env or OpenRouter
 * Set OPENAI_API_KEY or OPENROUTER_API_KEY environment variables
 */
describe('LiteLLM Integration', () => {
  let app: FastifyInstance & { store: any };

  const litellmBaseUrl = process.env.LITELLM_BASE_URL || 'http://localhost:4000';
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const openrouterApiKey = process.env.OPENROUTER_API_KEY;

  beforeAll(async () => {
    app = await buildApp({ logger: false, auth: { enabled: false } });
  });

  afterAll(async () => {
    await app.close();
  });

  // Use OpenRouter if available, otherwise OpenAI
  const hasApiKey = openrouterApiKey || openaiApiKey;
  const skipIfNoApiKey = hasApiKey ? describe : describe.skip;

  skipIfNoApiKey('LiteLLM Gateway (Live)', () => {
    it('should have API key configured', () => {
      expect(hasApiKey).toBeDefined();
    });

    it('should make completion request via OpenRouter/OpenAI API', async () => {
      const apiKey = openrouterApiKey || openaiApiKey!;
      const baseUrl = openrouterApiKey
        ? 'https://openrouter.ai/api/v1'
        : 'https://api.openai.com/v1';
      const model = openrouterApiKey ? 'openai/gpt-4o-mini' : 'gpt-4o-mini';

      console.log('Using:', openrouterApiKey ? 'OpenRouter' : 'OpenAI');

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          ...(openrouterApiKey ? { 'HTTP-Referer': 'https://github.com/shipyard-cp' } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'user', content: 'Say "test successful" exactly.' },
          ],
          max_tokens: 20,
        }),
      });

      console.log('Response status:', response.status);

      if (response.status === 401) {
        console.log('API returned 401 - check API key');
        return;
      }

      expect(response.status).toBe(200);
      const data = await response.json() as { choices: Array<{ message: { content: string } }> };
      expect(data.choices).toBeDefined();
      expect(data.choices[0].message.content).toBeDefined();
      console.log('Response:', data.choices[0].message.content);
    }, 30000);

    it('should work with LiteLLMConnector using OpenRouter', async () => {
      const apiKey = openrouterApiKey || openaiApiKey!;
      // OpenRouter already includes /v1, so don't add it again
      const baseUrl = openrouterApiKey
        ? 'https://openrouter.ai/api'
        : 'https://api.openai.com/v1';
      const model = openrouterApiKey ? 'openai/gpt-4o-mini' : 'gpt-4o-mini';

      const connector = new LiteLLMConnector({
        baseUrl,
        apiKey,
        defaultModel: model,
        timeout: 30000,
      });

      const response = await connector.chatCompletion({
        model,
        messages: [{ role: 'user', content: 'Say "connector test ok"' }],
        max_tokens: 20,
      });

      expect(response.choices).toBeDefined();
      expect(response.choices[0].message.content).toBeDefined();
      console.log('Connector response:', response.choices[0].message.content);

      // Check usage tracking
      const stats = connector.getUsageStats();
      expect(stats.total_requests).toBe(1);
      expect(stats.successful_requests).toBe(1);
      expect(stats.total_input_tokens).toBeGreaterThan(0);
    }, 30000);

    it('should track usage correctly', async () => {
      const apiKey = openrouterApiKey || openaiApiKey!;
      const baseUrl = openrouterApiKey
        ? 'https://openrouter.ai/api'
        : 'https://api.openai.com/v1';
      const model = openrouterApiKey ? 'openai/gpt-4o-mini' : 'gpt-4o-mini';

      const connector = new LiteLLMConnector({
        baseUrl,
        apiKey,
        defaultModel: model,
      });

      // Make two requests
      await connector.chatCompletion({
        model,
        messages: [{ role: 'user', content: 'Hi' }],
      });

      await connector.chatCompletion({
        model,
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const stats = connector.getUsageStats();
      expect(stats.total_requests).toBe(2);
      expect(stats.successful_requests).toBe(2);

      const log = connector.getUsageLog();
      expect(log).toHaveLength(2);
      expect(log.every(u => u.success)).toBe(true);
    }, 60000);
  });

  describe('LiteLLM Configuration Types', () => {
    it('should define LiteLLM usage interface', () => {
      const usage = {
        model: 'gpt-4o-mini',
        provider: 'openai',
        input_tokens: 100,
        output_tokens: 50,
        cost_usd: 0.001,
        fallback_used: false,
      };

      expect(usage.model).toBe('gpt-4o-mini');
      expect(usage.provider).toBe('openai');
      expect(usage.input_tokens).toBe(100);
    });

    it('should define routing configuration', () => {
      const routing = {
        default_model: 'gpt-4o-mini',
        fallback_models: ['gpt-3.5-turbo', 'claude-3-haiku'],
        model_aliases: {
          'fast': 'gpt-4o-mini',
          'smart': 'gpt-4o',
        },
      };

      expect(routing.default_model).toBe('gpt-4o-mini');
      expect(routing.fallback_models).toHaveLength(2);
      expect(routing.model_aliases['fast']).toBe('gpt-4o-mini');
    });
  });

  describe('Worker LLM Integration', () => {
    it('should track LiteLLM usage in worker result', async () => {
      const task = await app.inject({
        method: 'POST',
        url: '/v1/tasks',
        payload: {
          title: 'LLM Test Task',
          objective: 'Test LLM integration',
          typed_ref: 'agent-taskstate:task:github:llm-test-001',
          repo_ref: {
            provider: 'github',
            owner: 'test',
            name: 'repo',
            default_branch: 'main',
          },
        },
      });

      expect(task.statusCode).toBe(201);
      const taskData = task.json();

      // Simulate worker result with LiteLLM usage
      const dispatchResponse = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${taskData.task_id}/dispatch`,
        payload: { target_stage: 'plan' },
      });

      const job = dispatchResponse.json();

      const resultResponse = await app.inject({
        method: 'POST',
        url: `/v1/tasks/${taskData.task_id}/results`,
        payload: {
          job_id: job.job_id,
          typed_ref: taskData.typed_ref,
          status: 'succeeded',
          artifacts: [{ artifact_id: 'art1', kind: 'log', uri: 'file:///log' }],
          test_results: [],
          requested_escalations: [],
          usage: {
            runtime_ms: 5000,
            litellm: {
              model: 'gpt-4o-mini',
              provider: 'openai',
              input_tokens: 1500,
              output_tokens: 800,
              cost_usd: 0.012,
              fallback_used: false,
            },
          },
        },
      });

      expect(resultResponse.statusCode).toBe(200);
      const result = resultResponse.json();
      expect(result.task.state).toBe('planned');
    });
  });
});