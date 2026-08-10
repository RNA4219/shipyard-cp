import { describe, expect, it, vi } from 'vitest';

import {
  BOUNDED_ADVISORY_MODEL_ID,
  BOUNDED_ADVISORY_PROTOCOL,
  BoundedAdvisoryError,
  boundedAdvisoryPreflight,
  executeBoundedAdvisory,
  validateBoundedAdvisoryRequest,
  validateBoundedAdvisoryRuntime,
} from '../src/bounded-glm-advisory-cli.js';
import type { ChatCompletionResponse } from '../src/domain/litellm/litellm-connector.js';

const request = {
  protocol_version: BOUNDED_ADVISORY_PROTOCOL,
  request_id: `promotion-operator-packet:${'a'.repeat(24)}`,
  model: 'glm-5',
  prompt: 'Return exactly one bounded advisory JSON object.',
  max_tokens: 1024,
};

const runtime = {
  backend: 'glm',
  model: 'glm-5',
  endpoint: 'https://coding-intl.dashscope.aliyuncs.com/v1',
  apiKey: 'test-only-secret',
};

function response(overrides: Partial<ChatCompletionResponse> = {}): ChatCompletionResponse {
  return {
    id: 'chat-test',
    object: 'chat.completion',
    created: 1,
    model: 'glm-5',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: '{"action":"continue_observation"}' },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
    ...overrides,
  };
}

describe('bounded GLM advisory CLI', () => {
  it('accepts only the exact sanitized request contract', () => {
    expect(validateBoundedAdvisoryRequest(request)).toEqual(request);
    expect(() => validateBoundedAdvisoryRequest({ ...request, model: 'other' }))
      .toThrowError(BoundedAdvisoryError);
    expect(() => validateBoundedAdvisoryRequest({ ...request, extra: true }))
      .toThrowError('SHIPYARD_BOUNDED_ADVISORY_REQUEST_SHAPE');
    expect(() => validateBoundedAdvisoryRequest({ ...request, prompt: 'read C:\\secret.txt' }))
      .toThrowError('SHIPYARD_BOUNDED_ADVISORY_LOCAL_PATH');
    expect(() => validateBoundedAdvisoryRequest({ ...request, max_tokens: 2048 }))
      .toThrowError('SHIPYARD_BOUNDED_ADVISORY_MAX_TOKENS');
  });

  it('requires Shipyard-owned GLM runtime without fallback', () => {
    expect(() => validateBoundedAdvisoryRuntime(runtime)).not.toThrow();
    expect(() => validateBoundedAdvisoryRuntime({ ...runtime, backend: 'opencode' }))
      .toThrowError('SHIPYARD_BOUNDED_ADVISORY_BACKEND');
    expect(() => validateBoundedAdvisoryRuntime({ ...runtime, apiKey: undefined }))
      .toThrowError('SHIPYARD_BOUNDED_ADVISORY_CREDENTIAL_MISSING');
    expect(() => validateBoundedAdvisoryRuntime({ ...runtime, endpoint: 'http://localhost:8080/v1' }))
      .toThrowError('SHIPYARD_BOUNDED_ADVISORY_ENDPOINT');
    expect(boundedAdvisoryPreflight(runtime)).toMatchObject({
      status: 'ready',
      model_id: BOUNDED_ADVISORY_MODEL_ID,
      credential_present: true,
      credential_exposed: false,
      fallback_enabled: false,
      tool_execution: false,
      external_delivery: false,
    });
  });

  it('uses deterministic completion settings and returns a bounded wrapper', async () => {
    const complete = vi.fn().mockResolvedValue(response());
    const result = await executeBoundedAdvisory(request, runtime, complete);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      model: 'glm-5',
      temperature: 0,
      max_tokens: 1024,
    }));
    expect(result).toMatchObject({
      status: 'ok',
      model_id: BOUNDED_ADVISORY_MODEL_ID,
      fallback_used: false,
      tool_execution: false,
      external_delivery: false,
    });
    expect(JSON.stringify(result)).not.toContain('test-only-secret');
  });

  it('rejects model substitution, fallback, and malformed completion shape', async () => {
    await expect(executeBoundedAdvisory(request, runtime, async () => response({ model: 'glm-4' })))
      .rejects.toThrowError('SHIPYARD_BOUNDED_ADVISORY_RESPONSE_MODEL');
    await expect(executeBoundedAdvisory(
      request,
      runtime,
      async () => response({ _litellm: { fallback_used: true } }),
    )).rejects.toThrowError('SHIPYARD_BOUNDED_ADVISORY_RESPONSE_MODEL');
    await expect(executeBoundedAdvisory(request, runtime, async () => response({ choices: [] })))
      .rejects.toThrowError('SHIPYARD_BOUNDED_ADVISORY_RESPONSE_SHAPE');
  });
});
