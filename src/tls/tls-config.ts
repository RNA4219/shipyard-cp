/**
 * TLS Configuration for HTTPS
 *
 * Supports:
 * - Custom certificate files (cert.pem, key.pem)
 * - Let's Encrypt / ACME certificates
 * - Self-signed certificates for development
 * - Automatic HTTP to HTTPS redirect
 */

import fs from 'fs';
import path from 'path';
import type { SecureVersion } from 'tls';
import { getLogger } from '../monitoring/index.js';

const logger = getLogger();

export interface TLSConfig {
  /** Enable TLS/HTTPS */
  enabled: boolean;
  /** Path to certificate file (PEM format) */
  certPath?: string;
  /** Path to private key file (PEM format) */
  keyPath?: string;
  /** Path to CA certificate file (for mTLS) */
  caPath?: string;
  /** Passphrase for encrypted private key */
  passphrase?: string;
  /** Minimum TLS version */
  minVersion?: 'TLSv1.2' | 'TLSv1.3';
  /** Enable HTTP to HTTPS redirect */
  redirectHttp?: boolean;
  /** HTTP port for redirect (default: 80) */
  httpPort?: number;
  /** HTTPS port (default: 443) */
  httpsPort?: number;
  /** Enable HSTS header */
  hsts?: boolean;
  /** HSTS max-age in seconds */
  hstsMaxAge?: number;
  /** Enable HSTS includeSubDomains */
  hstsIncludeSubDomains?: boolean;
  /** Cipher suites (OpenSSL format) */
  ciphers?: string;
  /** Honor cipher order */
  honorCipherOrder?: boolean;
}

export interface TLSOptions {
  cert: Buffer | string;
  key: Buffer | string;
  ca?: Buffer | string;
  passphrase?: string;
  minVersion?: SecureVersion;
  ciphers?: string;
  honorCipherOrder?: boolean;
}

/**
 * Load TLS configuration from environment variables.
 */
export function loadTLSConfig(): TLSConfig {
  const enabled = process.env.TLS_ENABLED === 'true' ||
                  !!(process.env.TLS_CERT_PATH || process.env.TLS_KEY_PATH);

  return {
    enabled,
    certPath: process.env.TLS_CERT_PATH,
    keyPath: process.env.TLS_KEY_PATH,
    caPath: process.env.TLS_CA_PATH,
    passphrase: process.env.TLS_PASSPHRASE,
    minVersion: (process.env.TLS_MIN_VERSION as TLSConfig['minVersion']) || 'TLSv1.2',
    redirectHttp: process.env.TLS_REDIRECT_HTTP !== 'false',
    httpPort: parseInt(process.env.HTTP_PORT || '80', 10),
    httpsPort: parseInt(process.env.HTTPS_PORT || '443', 10),
    hsts: process.env.TLS_HSTS !== 'false',
    hstsMaxAge: parseInt(process.env.TLS_HSTS_MAX_AGE || '31536000', 10), // 1 year
    hstsIncludeSubDomains: process.env.TLS_HSTS_INCLUDE_SUBDOMAINS === 'true',
    ciphers: process.env.TLS_CIPHERS,
    honorCipherOrder: process.env.TLS_HONOR_CIPHER_ORDER === 'true',
  };
}

/**
 * Load TLS options for Fastify/Node.js HTTPS server.
 * Returns null if TLS is not enabled or certificates cannot be loaded.
 */
export function loadTLSOptions(config: TLSConfig): TLSOptions | null {
  if (!config.enabled) {
    return null;
  }

  if (!config.certPath || !config.keyPath) {
    logger.warn('TLS enabled but certificate or key path not specified');
    return null;
  }

  try {
    const cert = fs.readFileSync(path.resolve(config.certPath));
    const key = fs.readFileSync(path.resolve(config.keyPath));

    const options: TLSOptions = {
      cert,
      key,
      minVersion: config.minVersion,
    };

    if (config.caPath) {
      options.ca = fs.readFileSync(path.resolve(config.caPath));
    }

    if (config.passphrase) {
      options.passphrase = config.passphrase;
    }

    if (config.ciphers) {
      options.ciphers = config.ciphers;
    }

    if (config.honorCipherOrder !== undefined) {
      options.honorCipherOrder = config.honorCipherOrder;
    }

    logger.info('TLS certificates loaded successfully');
    return options;
  } catch (error) {
    logger.error(error instanceof Error ? error : new Error(String(error)), 'Failed to load TLS certificates');
    return null;
  }
}

/**
 * Generate a self-signed certificate for development.
 * This should NEVER be used in production.
 */
export function generateSelfSignedCert(_options?: {
  days?: number;
  commonName?: string;
  organization?: string;
}): { cert: string; key: string } {
  // This is a placeholder - in production, use a proper certificate generation library
  // or external tools like openssl
  throw new Error(
    'Self-signed certificate generation requires the "node-forge" or "pem" package. ' +
    'For development, use: openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"'
  );
}

/**
 * Check if we're behind a reverse proxy that handles TLS termination.
 * In this case, we don't need to enable TLS on the application server.
 */
export function isBehindProxy(): boolean {
  return process.env.TRUST_PROXY === 'true' ||
         process.env.FORWARDED_PROTO === 'https';
}

/**
 * Get the appropriate port based on TLS configuration.
 */
export function getPort(config: TLSConfig): number {
  if (config.enabled && config.httpsPort) {
    return config.httpsPort;
  }
  return parseInt(process.env.PORT || '3000', 10);
}

/**
 * Create HSTS header value.
 */
export function createHSTSHeaderValue(config: TLSConfig): string | null {
  if (!config.hsts) {
    return null;
  }

  const parts = [`max-age=${config.hstsMaxAge || 31536000}`];
  if (config.hstsIncludeSubDomains) {
    parts.push('includeSubDomains');
  }
  return parts.join('; ');
}

/**
 * Default secure cipher suites for TLS 1.2/1.3
 * Based on Mozilla's recommended cipher suite
 */
export const DEFAULT_CIPHERS = [
  // TLS 1.3 ciphers (automatically used when available)
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  // TLS 1.2 ciphers
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'DHE-RSA-AES128-GCM-SHA256',
  'DHE-RSA-AES256-GCM-SHA384',
].join(':');

/**
 * Security headers middleware for HTTPS.
 */
export function getSecurityHeaders(config: TLSConfig): Record<string, string> {
  const headers: Record<string, string> = {};

  // HSTS
  const hstsValue = createHSTSHeaderValue(config);
  if (hstsValue) {
    headers['Strict-Transport-Security'] = hstsValue;
  }

  // Additional security headers
  headers['X-Content-Type-Options'] = 'nosniff';
  headers['X-Frame-Options'] = 'DENY';
  headers['X-XSS-Protection'] = '1; mode=block';

  return headers;
}