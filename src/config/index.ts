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
  memxResolverUrl: string;
  trackerBridgeUrl: string;
}

export interface ApiKeysConfig {
  githubToken?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
  geminiApiKey?: string;
}

export interface GoogleCloudConfig {
  projectId?: string;
  applicationCredentials?: string;
}

export interface AuthConfig {
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

export interface Config {
  server: ServerConfig;
  redis: RedisConfig;
  externalServices: ExternalServicesConfig;
  apiKeys: ApiKeysConfig;
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

/**
 * Load configuration from environment variables.
 */
export function loadConfig(): Config {
  return {
    server: {
      port: getEnvNumber('PORT', 3000),
      nodeEnv: (getEnvString('NODE_ENV', 'development') as ServerConfig['nodeEnv']),
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
      memxResolverUrl: getEnvString('MEMX_RESOLVER_URL', 'http://localhost:8080'),
      trackerBridgeUrl: getEnvString('TRACKER_BRIDGE_URL', 'http://localhost:8081'),
    },
    apiKeys: {
      githubToken: getEnvOptional('GITHUB_TOKEN'),
      openaiApiKey: getEnvOptional('OPENAI_API_KEY'),
      anthropicApiKey: getEnvOptional('ANTHROPIC_API_KEY'),
      googleApiKey: getEnvOptional('GOOGLE_API_KEY'),
      geminiApiKey: getEnvOptional('GEMINI_API_KEY'),
    },
    googleCloud: {
      projectId: getEnvOptional('GOOGLE_CLOUD_PROJECT'),
      applicationCredentials: getEnvOptional('GOOGLE_APPLICATION_CREDENTIALS'),
    },
    auth: {
      apiKey: getEnvOptional('API_KEY'),
      adminApiKey: getEnvOptional('ADMIN_API_KEY'),
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