import type { RiskLevel } from '../../types.js';
import { getLogger } from '../../monitoring/index.js';

const logger = getLogger();

/**
 * LiteLLM configuration
 */
export interface LiteLLMConfig {
  /** LiteLLM proxy endpoint */
  baseUrl: string;
  /** API key for authentication */
  apiKey?: string;
  /** Default model to use */
  defaultModel?: string;
  /** Model aliases */
  modelAliases?: Record<string, string>;
  /** Fallback models */
  fallbackModels?: string[];
  /** Request timeout in ms */
  timeout?: number;
  /** Enable fallback on failure */
  enableFallback?: boolean;
}

/**
 * Chat completion request
 */
export interface ChatCompletionRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  metadata?: Record<string, string | number | boolean>;
  /** Task context for routing */
  task_context?: {
    task_id?: string;
    stage?: string;
    risk_level?: RiskLevel;
  };
}

/**
 * Chat completion response
 */
export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: 'stop' | 'length' | 'content_filter' | 'error';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  /** LiteLLM specific fields */
  _litellm?: {
    model_alias?: string;
    original_model?: string;
    fallback_used?: boolean;
    provider?: string;
    latency_ms?: number;
  };
}

/**
 * LiteLLM error response
 */
export interface LiteLLMError {
  type: 'auth_error' | 'rate_limit' | 'model_not_found' | 'context_length' | 'content_filter' | 'internal_error';
  message: string;
  code?: string;
  retryable: boolean;
}

/**
 * Model routing configuration
 */
export interface ModelRouting {
  /** Model alias name */
  alias: string;
  /** Target model(s) */
  targetModels: string[];
  /** Routing strategy */
  strategy: 'first_available' | 'round_robin' | 'least_latency';
  /** Fallback models if primary fails */
  fallback?: string[];
}

/**
 * Usage tracking
 */
export interface LiteLLMUsage {
  request_id: string;
  model: string;
  provider: string;
  model_alias?: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number;
  fallback_used: boolean;
  success: boolean;
  error?: string;
}

/**
 * LiteLLM Connector
 *
 * Handles all LLM inference requests through LiteLLM proxy.
 * Provides model aliasing, routing, fallback, and usage tracking.
 */
export class LiteLLMConnector {
  private config: LiteLLMConfig;
  private usageLog: LiteLLMUsage[] = [];

  constructor(config: LiteLLMConfig) {
    this.config = {
      timeout: 60000,
      enableFallback: true,
      defaultModel: 'gpt-4o-mini',
      ...config,
    };
  }

  /**
   * Create a chat completion
   */
  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const resolvedModel = this.resolveModel(request.model);
    const modelsToTry = this.getModelsWithFallback(resolvedModel);

    let lastError: Error | null = null;

    for (const model of modelsToTry) {
      try {
        const response = await this.makeRequest({
          ...request,
          model,
        });

        // Track usage
        this.trackUsage({
          request_id: response.id,
          model: response.model,
          provider: response._litellm?.provider || 'unknown',
          model_alias: response._litellm?.model_alias,
          input_tokens: response.usage.prompt_tokens,
          output_tokens: response.usage.completion_tokens,
          cost_usd: this.calculateCost(response),
          latency_ms: 0, // Set by makeRequest
          fallback_used: model !== resolvedModel,
          success: true,
        });

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        const litellmError = this.parseError(error);

        if (!litellmError.retryable) {
          break;
        }

        // Log failed attempt
        this.trackUsage({
          request_id: `failed-${Date.now()}`,
          model,
          provider: 'unknown',
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: 0,
          latency_ms: 0,
          fallback_used: false,
          success: false,
          error: litellmError.message,
        });
      }
    }

    // All models failed
    throw lastError || new Error('All models failed');
  }

  /**
   * Stream a chat completion
   */
  async *streamCompletion(
    request: ChatCompletionRequest
  ): AsyncGenerator<{ delta: string; done: boolean }> {
    const resolvedModel = this.resolveModel(request.model);

    const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        ...request,
        model: resolvedModel,
        stream: true,
      }),
      signal: AbortSignal.timeout(this.config.timeout!),
    });

    if (!response.ok) {
      throw await this.createErrorFromResponse(response);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              yield { delta: '', done: true };
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                yield { delta: content, done: false };
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<Array<{ id: string; object: string }>> {
    const response = await fetch(`${this.config.baseUrl}/v1/models`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.status}`);
    }

    const data = await response.json() as { data?: Array<{ id: string; object: string }> };
    return data.data || [];
  }

  /**
   * Get model routing info
   */
  getModelRouting(): Map<string, ModelRouting> {
    const routing = new Map<string, ModelRouting>();

    // Default routing based on config
    if (this.config.modelAliases) {
      for (const [alias, target] of Object.entries(this.config.modelAliases)) {
        routing.set(alias, {
          alias,
          targetModels: [target],
          strategy: 'first_available',
        });
      }
    }

    return routing;
  }

  /**
   * Get usage log
   */
  getUsageLog(): LiteLLMUsage[] {
    return [...this.usageLog];
  }

  /**
   * Clear usage log
   */
  clearUsageLog(): void {
    this.usageLog = [];
  }

  /**
   * Get total usage statistics
   */
  getUsageStats(): {
    total_requests: number;
    successful_requests: number;
    failed_requests: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost_usd: number;
    by_model: Record<string, { count: number; tokens: number; cost: number }>;
  } {
    const stats = {
      total_requests: this.usageLog.length,
      successful_requests: 0,
      failed_requests: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_cost_usd: 0,
      by_model: {} as Record<string, { count: number; tokens: number; cost: number }>,
    };

    for (const usage of this.usageLog) {
      if (usage.success) {
        stats.successful_requests++;
        stats.total_input_tokens += usage.input_tokens;
        stats.total_output_tokens += usage.output_tokens;
        stats.total_cost_usd += usage.cost_usd;

        const model = usage.model_alias || usage.model;
        if (!stats.by_model[model]) {
          stats.by_model[model] = { count: 0, tokens: 0, cost: 0 };
        }
        stats.by_model[model].count++;
        stats.by_model[model].tokens += usage.input_tokens + usage.output_tokens;
        stats.by_model[model].cost += usage.cost_usd;
      } else {
        stats.failed_requests++;
      }
    }

    return stats;
  }

  // --- Private methods ---

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    return headers;
  }

  private resolveModel(model: string): string {
    // Check aliases
    if (this.config.modelAliases?.[model]) {
      return this.config.modelAliases[model];
    }
    return model;
  }

  private getModelsWithFallback(model: string): string[] {
    const models = [model];

    if (this.config.enableFallback && this.config.fallbackModels) {
      models.push(...this.config.fallbackModels.filter((m) => m !== model));
    }

    return models;
  }

  private async makeRequest(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const startTime = Date.now();

    const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.config.timeout!),
    });

    if (!response.ok) {
      throw await this.createErrorFromResponse(response);
    }

    const data = await response.json() as ChatCompletionResponse;

    // Add latency to response
    return {
      ...data,
      _litellm: {
        ...(data._litellm || {}),
        latency_ms: Date.now() - startTime,
      },
    };
  }

  private async createErrorFromResponse(response: Response): Promise<Error> {
    let errorMessage = `HTTP ${response.status}`;

    try {
      const data = await response.json() as { error?: { message?: string }; message?: string };
      errorMessage = data.error?.message || data.message || errorMessage;
    } catch {
      // Ignore parse errors
    }

    return new Error(errorMessage);
  }

  private parseError(error: unknown): LiteLLMError {
    if (!(error instanceof Error)) {
      return {
        type: 'internal_error',
        message: 'Unknown error',
        retryable: false,
      };
    }

    const message = error.message.toLowerCase();

    if (message.includes('401') || message.includes('unauthorized')) {
      return {
        type: 'auth_error',
        message: error.message,
        retryable: false,
      };
    }

    if (message.includes('429') || message.includes('rate limit')) {
      return {
        type: 'rate_limit',
        message: error.message,
        retryable: true,
      };
    }

    if (message.includes('not found') || message.includes('does not exist')) {
      return {
        type: 'model_not_found',
        message: error.message,
        retryable: false,
      };
    }

    if (message.includes('context') || message.includes('token')) {
      return {
        type: 'context_length',
        message: error.message,
        retryable: false,
      };
    }

    if (message.includes('content filter')) {
      return {
        type: 'content_filter',
        message: error.message,
        retryable: false,
      };
    }

    return {
      type: 'internal_error',
      message: error.message,
      retryable: true,
    };
  }

  private calculateCost(response: ChatCompletionResponse): number {
    // Simplified cost calculation
    // In production, use actual pricing data
    const inputCost = response.usage.prompt_tokens * 0.00001;
    const outputCost = response.usage.completion_tokens * 0.00003;
    return inputCost + outputCost;
  }

  private trackUsage(usage: LiteLLMUsage): void {
    this.usageLog.push(usage);

    // Keep only last 1000 entries
    if (this.usageLog.length > 1000) {
      this.usageLog = this.usageLog.slice(-1000);
    }
  }
}