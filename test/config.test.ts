import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, resetConfig, resolveGlmApiKey } from '../src/config/index.js';

const KEYS = ['Alibaba_CodingPlan_KEY', 'GLM_API_KEY', 'DASHSCOPE_API_KEY'] as const;

function withEnv(values: Partial<Record<(typeof KEYS)[number], string | undefined>>, fn: () => void) {
  const previous = new Map<string, string | undefined>();
  for (const key of KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    resetConfig();
  }
}

describe('config GLM API key resolution', () => {
  afterEach(() => {
    resetConfig();
  });

  it('prefers Alibaba_CodingPlan_KEY when it is a real secret', () => {
    withEnv({
      Alibaba_CodingPlan_KEY: 'sk-alibaba-real',
      GLM_API_KEY: 'sk-glm-real',
      DASHSCOPE_API_KEY: 'sk-dashscope-real',
    }, () => {
      expect(resolveGlmApiKey()).toBe('sk-alibaba-real');
    });
  });

  it('ignores placeholder Alibaba_CodingPlan_KEY and falls back to GLM_API_KEY', () => {
    withEnv({
      Alibaba_CodingPlan_KEY: 'YOUR_SECRET_KEY',
      GLM_API_KEY: 'sk-glm-real',
      DASHSCOPE_API_KEY: 'sk-dashscope-real',
    }, () => {
      expect(resolveGlmApiKey()).toBe('sk-glm-real');
    });
  });

  it('ignores URL-shaped API key values', () => {
    withEnv({
      Alibaba_CodingPlan_KEY: undefined,
      GLM_API_KEY: 'https://coding-intl.dashscope.aliyuncs.com/v1',
      DASHSCOPE_API_KEY: 'sk-dashscope-real',
    }, () => {
      expect(resolveGlmApiKey()).toBe('sk-dashscope-real');
    });
  });

  it('uses sanitized GLM key in loaded config', () => {
    withEnv({
      Alibaba_CodingPlan_KEY: 'YOUR_SECRET_KEY',
      GLM_API_KEY: 'sk-glm-real',
    }, () => {
      expect(loadConfig().apiKeys.glmApiKey).toBe('sk-glm-real');
    });
  });
});
