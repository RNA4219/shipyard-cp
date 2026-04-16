/**
 * Shipyard Control Plane Configuration
 *
 * Centralized configuration from environment variables.
 */

export interface RedisConfig {
  url: string;
  keyPrefix: string;
  taskTtl: number;
  jobTtl: number;
  resultTtl: number;
  eventTtl: number;
}

export interface ServerConfig {
  port: number;
  nodeEnv: 'development' | 'production' | 'test';
  logLevel: string;
}

export interface ExternalServicesConfig {
  /** @deprecated Use memx-resolver-js package directly */
  memxResolverUrl?: string;
  /** @deprecated Use tracker-bridge-js package directly */
  trackerBridgeUrl?: string;
}

export interface ApiKeysConfig {
  githubToken?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
  geminiApiKey?: string;
  /** Alibaba Cloud / GLM API Key */
  glmApiKey?: string;
}

export interface WorkerConfig {
  /** Execution backend for logical Claude worker */
  claudeBackend: 'opencode' | 'glm' | 'claude_cli' | 'simulation';
  /** Execution backend for logical Codex worker */
  codexBackend: 'opencode' | 'simulation';
  /** Default model for Claude Code */
  claudeModel: string;
  /** Default model for Codex */
  codexModel: string;
  /** Default model for Antigravity */
  antigravityModel: string;
  /** GLM model for Alibaba Cloud */
  glmModel: string;
  /** GLM API endpoint (Alibaba Cloud) */
  glmApiEndpoint: string;
  /** Claude Code CLI path */
  claudeCliPath: string;
  /** OpenCode CLI path */
  opencodeCliPath: string;
  /** Working directory for job execution */
  workDir: string;
  /** Job execution timeout in milliseconds */
  jobTimeout: number;
  /** Skip permission prompts (dangerous - use only in trusted environments) */
  skipPermissions: boolean;
  /** Enable debug mode for worker execution */
  debugMode: boolean;
}

export interface GoogleCloudConfig {
  projectId?: string;
  applicationCredentials?: string;
}

export interface AuthConfig {
  enabled: boolean;
  apiKey?: string;
  adminApiKey?: string;
}

export interface MonitoringConfig {
  enabled: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  metricsEnabled: boolean;
  metricsPath: string;
}

export interface TLSConfigSettings {
  enabled: boolean;
  certPath?: string;
  keyPath?: string;
  caPath?: string;
  passphrase?: string;
  minVersion: 'TLSv1.2' | 'TLSv1.3';
  redirectHttp: boolean;
  httpPort: number;
  httpsPort: number;
  hsts: boolean;
  hstsMaxAge: number;
  hstsIncludeSubDomains: boolean;
}

export interface OpenCodeServeConfig {
  /** Execution mode: 'run' (default) or 'serve' */
  mode: 'run' | 'serve';
  /** Path to opencode serve binary (defaults to opencodeCliPath) */
  servePath: string;
  /** Base URL for opencode serve API (e.g., http://localhost:3001) */
  serveBaseUrl: string;
  /** Session reuse policy: 'disabled' or 'same_stage' */
  sessionReuse: 'disabled' | 'same_stage';
  /** Session TTL in milliseconds */
  sessionTtlMs: number;
  /** Server startup timeout in milliseconds */
  serverStartupTimeoutMs: number;
  /** Reuse lease TTL in milliseconds */
  reuseLeaseTtlMs: number;
}

export interface Config {
  server: ServerConfig;
  redis: RedisConfig;
  externalServices: ExternalServicesConfig;
  apiKeys: ApiKeysConfig;
  worker: WorkerConfig;
  opencodeServe: OpenCodeServeConfig;
  googleCloud: GoogleCloudConfig;
  auth: AuthConfig;
  monitoring: MonitoringConfig;
  tls: TLSConfigSettings;
}

// Default TTL values in seconds
const DEFAULT_TASK_TTL = 7 * 24 * 60 * 60; // 7 days
const DEFAULT_JOB_TTL = 24 * 60 * 60; // 24 hours
const DEFAULT_RESULT_TTL = 24 * 60 * 60; // 24 hours
const DEFAULT_EVENT_TTL = 30 * 24 * 60 * 60; // 30 days

// Default OpenCode serve values in milliseconds
const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_SERVER_STARTUP_TIMEOUT_MS = 30 * 1000; // 30 seconds
const DEFAULT_REUSE_LEASE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getEnvString(key: string, defaultValue: string = ''): string {
  return process.env[key] ?? defaultValue;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function getEnvOptional(key: string): string | undefined {
  return process.env[key] || undefined;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

/**
 * Load configuration from environment variables.
 */
export function loadConfig(): Config {
  const nodeEnv = (getEnvString('NODE_ENV', 'development') as ServerConfig['nodeEnv']);
  const apiKey = getEnvOptional('API_KEY');
  const adminApiKey = getEnvOptional('ADMIN_API_KEY');
  const authEnabledDefault = nodeEnv === 'production' || !!apiKey || !!adminApiKey;

  return {
    server: {
      port: getEnvNumber('PORT', 3100),
      nodeEnv,
      logLevel: getEnvString('LOG_LEVEL', 'info'),
    },
    redis: {
      url: getEnvString('REDIS_URL', 'redis://localhost:6379'),
      keyPrefix: getEnvString('REDIS_KEY_PREFIX', 'shipyard-cp:'),
      taskTtl: getEnvNumber('REDIS_TASK_TTL', DEFAULT_TASK_TTL),
      jobTtl: getEnvNumber('REDIS_JOB_TTL', DEFAULT_JOB_TTL),
      resultTtl: getEnvNumber('REDIS_RESULT_TTL', DEFAULT_RESULT_TTL),
      eventTtl: getEnvNumber('REDIS_EVENT_TTL', DEFAULT_EVENT_TTL),
    },
    externalServices: {
      memxResolverUrl: getEnvOptional('MEMX_RESOLVER_URL'),
      trackerBridgeUrl: getEnvOptional('TRACKER_BRIDGE_URL'),
    },
    apiKeys: {
      githubToken: getEnvOptional('GITHUB_TOKEN'),
      openaiApiKey: getEnvOptional('OPENAI_API_KEY'),
      anthropicApiKey: getEnvOptional('ANTHROPIC_API_KEY'),
      googleApiKey: getEnvOptional('GOOGLE_API_KEY'),
      geminiApiKey: getEnvOptional('GEMINI_API_KEY'),
      glmApiKey: getEnvOptional('Alibaba_CodingPlan_KEY') || getEnvOptional('GLM_API_KEY') || getEnvOptional('DASHSCOPE_API_KEY'),
    },
    worker: {
      claudeBackend: (getEnvString('CLAUDE_WORKER_BACKEND', 'opencode') as WorkerConfig['claudeBackend']),
      codexBackend: (getEnvString('CODEX_WORKER_BACKEND', 'opencode') as WorkerConfig['codexBackend']),
      claudeModel: getEnvString('CLAUDE_MODEL', 'glm-5'),
      codexModel: getEnvString('CODEX_MODEL', 'gpt-4.1'),
      antigravityModel: getEnvString('ANTIGRAVITY_MODEL', 'gemini-2.5-pro'),
      glmModel: getEnvString('Alibaba_CodingPlan_MODEL', 'glm-5'),
      glmApiEndpoint: getEnvString('Alibaba_CodingPlan_API_ENDPOINT', 'https://coding-intl.dashscope.aliyuncs.com/v1'),
      claudeCliPath: getEnvString('CLAUDE_CLI_PATH', 'claude'),
      opencodeCliPath: getEnvString('OPENCODE_CLI_PATH', 'opencode'),
      workDir: getEnvString('WORKER_WORK_DIR', '/tmp/shipyard-jobs'),
      jobTimeout: getEnvNumber('WORKER_JOB_TIMEOUT', 600000), // 10 minutes
      skipPermissions: getEnvString('WORKER_SKIP_PERMISSIONS', 'false') === 'true',
      debugMode: getEnvString('WORKER_DEBUG_MODE', 'false') === 'true',
    },
    opencodeServe: {
      mode: (getEnvString('OPENCODE_MODE', 'run') as OpenCodeServeConfig['mode']),
      servePath: getEnvString('OPENCODE_SERVE_PATH', getEnvString('OPENCODE_CLI_PATH', 'opencode')),
      serveBaseUrl: getEnvString('OPENCODE_SERVE_BASE_URL', 'http://localhost:3001'),
      sessionReuse: (getEnvString('OPENCODE_SESSION_REUSE', 'disabled') as OpenCodeServeConfig['sessionReuse']),
      sessionTtlMs: getEnvNumber('OPENCODE_SESSION_TTL_MS', DEFAULT_SESSION_TTL_MS),
      serverStartupTimeoutMs: getEnvNumber('OPENCODE_SERVER_STARTUP_TIMEOUT_MS', DEFAULT_SERVER_STARTUP_TIMEOUT_MS),
      reuseLeaseTtlMs: getEnvNumber('OPENCODE_REUSE_LEASE_TTL_MS', DEFAULT_REUSE_LEASE_TTL_MS),
    },
    googleCloud: {
      projectId: getEnvOptional('GOOGLE_CLOUD_PROJECT'),
      applicationCredentials: getEnvOptional('GOOGLE_APPLICATION_CREDENTIALS'),
    },
    auth: {
      enabled: getEnvBoolean('AUTH_ENABLED', authEnabledDefault),
      apiKey,
      adminApiKey,
    },
    monitoring: {
      enabled: getEnvString('MONITORING_ENABLED', 'true') === 'true',
      logLevel: (getEnvString('LOG_LEVEL', 'info') as MonitoringConfig['logLevel']),
      metricsEnabled: getEnvString('METRICS_ENABLED', 'true') === 'true',
      metricsPath: getEnvString('METRICS_PATH', '/metrics'),
    },
    tls: {
      enabled: getEnvString('TLS_ENABLED', 'false') === 'true' ||
               !!(process.env.TLS_CERT_PATH && process.env.TLS_KEY_PATH),
      certPath: getEnvOptional('TLS_CERT_PATH'),
      keyPath: getEnvOptional('TLS_KEY_PATH'),
      caPath: getEnvOptional('TLS_CA_PATH'),
      passphrase: getEnvOptional('TLS_PASSPHRASE'),
      minVersion: (getEnvString('TLS_MIN_VERSION', 'TLSv1.2') as TLSConfigSettings['minVersion']),
      redirectHttp: getEnvString('TLS_REDIRECT_HTTP', 'true') === 'true',
      httpPort: getEnvNumber('HTTP_PORT', 80),
      httpsPort: getEnvNumber('HTTPS_PORT', 443),
      hsts: getEnvString('TLS_HSTS', 'true') === 'true',
      hstsMaxAge: getEnvNumber('TLS_HSTS_MAX_AGE', 31536000),
      hstsIncludeSubDomains: getEnvString('TLS_HSTS_INCLUDE_SUBDOMAINS', 'false') === 'true',
    },
  };
}

/**
 * Global configuration instance (lazy loaded).
 */
let _config: Config | null = null;

/**
 * Get the global configuration instance.
 */
export function getConfig(): Config {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

/**
 * Reset configuration (useful for testing).
 */
export function resetConfig(): void {
  _config = null;
}
