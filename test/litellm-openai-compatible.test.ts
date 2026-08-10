import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiteLLMConnector } from '../src/domain/litellm/litellm-connector.js';

describe('LM Studio OpenAI-compatible HTTP client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LITELLM_MOCK;
  });

  it('uses only /models and /chat/completions with a bearer token', async () => {
    process.env.LITELLM_MOCK = 'false';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'remote-qwen', object: 'model' }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'chat-1', object: 'chat.completion', created: 1, model: 'remote-qwen', choices: [{ index: 0, message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }] })));
    vi.stubGlobal('fetch', fetchMock);

    const connector = new LiteLLMConnector({ baseUrl: 'http://lmstudio.test/v1', apiKey: 'test-token', defaultModel: 'remote-qwen' });
    const models = await connector.listModels();
    const responseFormat = {
      type: 'json_schema' as const,
      json_schema: {
        name: 'proof',
        strict: true,
        schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      },
    };
    const completion = await connector.chatCompletion({ model: 'remote-qwen', messages: [{ role: 'user', content: 'return json' }], response_format: responseFormat });

    expect(models).toEqual([{ id: 'remote-qwen', object: 'model' }]);
    expect(completion.usage).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
    expect(fetchMock.mock.calls[0][0]).toBe('http://lmstudio.test/v1/models');
    expect(fetchMock.mock.calls[1][0]).toBe('http://lmstudio.test/v1/chat/completions');
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer test-token' });
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toMatchObject({ response_format: responseFormat });
  });
});
