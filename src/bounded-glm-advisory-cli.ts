import 'dotenv/config';

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { getConfig, type Config } from './config/index.js';
import {
  LiteLLMConnector,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
} from './domain/litellm/litellm-connector.js';

export const BOUNDED_ADVISORY_PROTOCOL = 'shipyard-cp/bounded-glm-advisory/v1';
export const BOUNDED_ADVISORY_MODEL = 'glm-5';
export const BOUNDED_ADVISORY_MODEL_ID = 'shipyard-cp/alibaba_cloud/glm-5';
export const BOUNDED_ADVISORY_PROVIDER = 'alibaba_cloud';

const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_PROMPT_BYTES = 96 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_KEYS = new Set([
  'protocol_version',
  'request_id',
  'model',
  'prompt',
  'max_tokens',
]);

export interface BoundedAdvisoryRequest {
  protocol_version: typeof BOUNDED_ADVISORY_PROTOCOL;
  request_id: string;
  model: typeof BOUNDED_ADVISORY_MODEL;
  prompt: string;
  max_tokens: number;
}

export interface BoundedAdvisoryRuntime {
  backend: string;
  model: string;
  endpoint: string;
  apiKey?: string;
}

export interface BoundedAdvisoryResult {
  protocol_version: typeof BOUNDED_ADVISORY_PROTOCOL;
  status: 'ok';
  request_id: string;
  provider: typeof BOUNDED_ADVISORY_PROVIDER;
  model: typeof BOUNDED_ADVISORY_MODEL;
  model_id: typeof BOUNDED_ADVISORY_MODEL_ID;
  fallback_used: false;
  tool_execution: false;
  external_delivery: false;
  content: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class BoundedAdvisoryError extends Error {
  constructor(readonly reasonCode: string) {
    super(reasonCode);
    this.name = 'BoundedAdvisoryError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasLocalAbsolutePath(value: string): boolean {
  return /(?:^|[\s"'])(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|etc|var|tmp)\/)/.test(value);
}

function hasCredentialMaterial(value: string): boolean {
  return /(?:Bearer\s+[A-Za-z0-9._~+/=-]{16,}|\b(?:sk|key)-[A-Za-z0-9_-]{16,})/i.test(value);
}

export function validateBoundedAdvisoryRequest(value: unknown): BoundedAdvisoryRequest {
  if (!isRecord(value) || Object.keys(value).some((key) => !REQUEST_KEYS.has(key)) ||
      Object.keys(value).length !== REQUEST_KEYS.size) {
    throw new BoundedAdvisoryError('SHIPYARD_BOUNDED_ADVISORY_REQUEST_SHAPE');
  }
  if (value.protocol_version !== BOUNDED_ADVISORY_PROTOCOL) {
    throw new BoundedAdvisoryError('SHIPYARD_BOUNDED_ADVISORY_PROTOCOL');
  }
  if (typeof value.request_id !== 'string' ||
      !/^promotion-operator-packet:[a-f0-9]{24}$/.test(value.request_id)) {
    throw new BoundedAdvisoryError('SHIPYARD_BOUNDED_ADVISORY_REQUEST_ID');
  }
  if (value.model !== BOUNDED_ADVISORY_MODEL) {
    throw new BoundedAdvisoryError('SHIPYARD_BOUNDED_ADVISORY_MODEL');
  }
  if (typeof value.prompt !== 'string' || value.prompt.length === 0 ||
      Buffer.byteLength(value.prompt, 'utf8') > MAX_PROMPT_BYTES) {
    throw new BoundedAdvisoryError('SHIPYARD_BOUNDED_ADVISORY_PROMPT_SIZE');
  }
  if (hasLocalAbsolutePath(value.prompt)) {
    throw new BoundedAdvisoryError('SHIPYARD_BOUNDED_ADVISORY_LOCAL_PATH');
  }
  if (hasCredentialMaterial(value.prompt)) {
    throw new BoundedAdvisoryError('SHIPYARD_BOUNDED_ADVISORY_CREDENTIAL_MATERIAL');
  }
  if (value.max_tokens !== 1024) {
    throw new BoundedAdvisoryError('SHIPYARD_BOUNDED_ADVISORY_MAX_TOKENS');
  }
  return value as unknown as BoundedAdvisoryRequest;
}

export function runtimeFromConfig(config: Config): BoundedAdvisoryRuntime {
  return {
    backend: config.worker.claudeBackend,
    model: config.worker.glmModel,
    endpoint: config.worker.glmApiEndpoint,
    apiKey: config.apiKeys.glmApiKey,
  };
}

export function validateBoundedAdvisoryRuntime(runtime: BoundedAdvisoryRuntime): void {
  if (runtime.backend !== 'glm') {
    throw new BoundedAdvisoryError('SHIPYARD_BOUNDED_ADVISORY_BACKEND');
  }
  if (runtime.model !== BOUNDED_ADVISORY_MODEL) {
    throw new BoundedAdvisoryError('SHIPYARD_BOUNDED_ADVISORY_CONFIG_MODEL');
  }
  let endpoint: URL;
  try {
    endpoint = new URL(runtime.endpoint);
  } catch {
    throw new BoundedAdvisoryError('SHIPYARD_BOUNDED_ADVISORY_ENDPOINT');
  }
  if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'coding-intl.dashscope.aliyuncs.com' ||
      endpoint.pathname.replace(/\/$/, '') !== '/v1') {
    throw new BoundedAdvisoryError('SHIPYARD_BOUNDED_ADVISORY_ENDPOINT');
  }
  if (!runtime.apiKey) {
    throw new BoundedAdvisoryError('SHIPYARD_BOUNDED_ADVISORY_CREDENTIAL_MISSING');
  }
}

export function boundedAdvisoryPreflight(runtime: BoundedAdvisoryRuntime): Record<string, unknown> {
  validateBoundedAdvisoryRuntime(runtime);
  return {
    protocol_version: BOUNDED_ADVISORY_PROTOCOL,
    status: 'ready',
    provider: BOUNDED_ADVISORY_PROVIDER,
    model: BOUNDED_ADVISORY_MODEL,
    model_id: BOUNDED_ADVISORY_MODEL_ID,
    endpoint_id: 'dashscope-coding-intl-v1',
    credential_present: true,
    credential_exposed: false,
    fallback_enabled: false,
    tool_execution: false,
    external_delivery: false,
  };
}

export async function executeBoundedAdvisory(
  requestValue: unknown,
  runtime: BoundedAdvisoryRuntime,
  complete: (request: ChatCompletionRequest) => Promise<ChatCompletionResponse>,
): Promise<BoundedAdvisoryResult> {
  const request = validateBoundedAdvisoryRequest(requestValue);
  validateBoundedAdvisoryRuntime(runtime);
  const response = await complete({
    model: BOUNDED_ADVISORY_MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are a bounded JSON advisory worker. Do not call tools. Return exactly one JSON object without markdown or free text.',
      },
      { role: 'user', content: request.prompt },
    ],
    temperature: 0,
    max_tokens: request.max_tokens,
    metadata: {
      protocol: BOUNDED_ADVISORY_PROTOCOL,
      request_id: request.request_id,
      tool_execution: false,
      external_delivery: false,
    },
  });
  if (response.model !== BOUNDED_ADVISORY_MODEL || response._litellm?.fallback_used === true) {
    throw new BoundedAdvisoryError('SHIPYARD_BOUNDED_ADVISORY_RESPONSE_MODEL');
  }
  if (response.choices.length !== 1 || response.choices[0]?.finish_reason !== 'stop') {
    throw new BoundedAdvisoryError('SHIPYARD_BOUNDED_ADVISORY_RESPONSE_SHAPE');
  }
  const content = response.choices[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0 ||
      Buffer.byteLength(content, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new BoundedAdvisoryError('SHIPYARD_BOUNDED_ADVISORY_RESPONSE_SIZE');
  }
  return {
    protocol_version: BOUNDED_ADVISORY_PROTOCOL,
    status: 'ok',
    request_id: request.request_id,
    provider: BOUNDED_ADVISORY_PROVIDER,
    model: BOUNDED_ADVISORY_MODEL,
    model_id: BOUNDED_ADVISORY_MODEL_ID,
    fallback_used: false,
    tool_execution: false,
    external_delivery: false,
    content,
    usage: {
      prompt_tokens: response.usage.prompt_tokens,
      completion_tokens: response.usage.completion_tokens,
      total_tokens: response.usage.total_tokens,
    },
  };
}

function failure(reasonCode: string): Record<string, unknown> {
  return {
    protocol_version: BOUNDED_ADVISORY_PROTOCOL,
    status: 'failed',
    reason_code: reasonCode,
    credential_exposed: false,
    fallback_used: false,
    tool_execution: false,
    external_delivery: false,
  };
}

async function readRequest(path: string): Promise<unknown> {
  const encoded = await readFile(path);
  if (encoded.length === 0 || encoded.length > MAX_REQUEST_BYTES) {
    throw new BoundedAdvisoryError('SHIPYARD_BOUNDED_ADVISORY_REQUEST_SIZE');
  }
  try {
    return JSON.parse(encoded.toString('utf8')) as unknown;
  } catch {
    throw new BoundedAdvisoryError('SHIPYARD_BOUNDED_ADVISORY_REQUEST_JSON');
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const runtime = runtimeFromConfig(getConfig());
    if (argv.length === 1 && argv[0] === '--preflight') {
      process.stdout.write(`${JSON.stringify(boundedAdvisoryPreflight(runtime))}\n`);
      return 0;
    }
    if (argv.length !== 1) {
      throw new BoundedAdvisoryError('SHIPYARD_BOUNDED_ADVISORY_ARGUMENTS');
    }
    const request = await readRequest(argv[0]);
    validateBoundedAdvisoryRuntime(runtime);
    const connector = new LiteLLMConnector({
      baseUrl: runtime.endpoint,
      apiKey: runtime.apiKey,
      defaultModel: runtime.model,
      timeout: 180_000,
      enableFallback: false,
      fallbackModels: [],
    });
    const result = await executeBoundedAdvisory(
      request,
      runtime,
      (completion) => connector.chatCompletion(completion),
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const reasonCode = error instanceof BoundedAdvisoryError
      ? error.reasonCode
      : 'SHIPYARD_BOUNDED_ADVISORY_INVOCATION_FAILED';
    process.stdout.write(`${JSON.stringify(failure(reasonCode))}\n`);
    return 2;
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entryPoint) {
  process.exitCode = await main();
}
