/**
 * TLS Configuration Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadTLSConfig,
  loadTLSOptions,
  isBehindProxy,
  getPort,
  createHSTSHeaderValue,
  getSecurityHeaders,
  DEFAULT_CIPHERS,
  type TLSConfig,
} from '../src/tls/index.js';

describe('TLS Configuration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear TLS-related env vars
    delete process.env.TLS_ENABLED;
    delete process.env.TLS_CERT_PATH;
    delete process.env.TLS_KEY_PATH;
    delete process.env.TLS_CA_PATH;
    delete process.env.TLS_PASSPHRASE;
    delete process.env.TLS_MIN_VERSION;
    delete process.env.TLS_REDIRECT_HTTP;
    delete process.env.HTTP_PORT;
    delete process.env.HTTPS_PORT;
    delete process.env.TLS_HSTS;
    delete process.env.TLS_HSTS_MAX_AGE;
    delete process.env.TLS_HSTS_INCLUDE_SUBDOMAINS;
    delete process.env.TLS_CIPHERS;
    delete process.env.TLS_HONOR_CIPHER_ORDER;
    delete process.env.TRUST_PROXY;
    delete process.env.FORWARDED_PROTO;
    delete process.env.PORT;
  });

  afterEach(() => {
    // Restore original env
    Object.assign(process.env, originalEnv);
  });

  describe('loadTLSConfig', () => {
    it('should return disabled config when no TLS env vars are set', () => {
      const config = loadTLSConfig();
      expect(config.enabled).toBe(false);
    });

    it('should enable TLS when TLS_ENABLED is true', () => {
      process.env.TLS_ENABLED = 'true';
      const config = loadTLSConfig();
      expect(config.enabled).toBe(true);
    });

    it('should enable TLS when cert and key paths are provided', () => {
      process.env.TLS_CERT_PATH = '/path/to/cert.pem';
      process.env.TLS_KEY_PATH = '/path/to/key.pem';
      const config = loadTLSConfig();
      expect(config.enabled).toBe(true);
    });

    it('should load all TLS configuration from env vars', () => {
      process.env.TLS_ENABLED = 'true';
      process.env.TLS_CERT_PATH = '/cert.pem';
      process.env.TLS_KEY_PATH = '/key.pem';
      process.env.TLS_CA_PATH = '/ca.pem';
      process.env.TLS_PASSPHRASE = 'secret';
      process.env.TLS_MIN_VERSION = 'TLSv1.3';
      process.env.TLS_REDIRECT_HTTP = 'false';
      process.env.HTTP_PORT = '8080';
      process.env.HTTPS_PORT = '8443';
      process.env.TLS_HSTS = 'false';
      process.env.TLS_HSTS_MAX_AGE = '86400';
      process.env.TLS_HSTS_INCLUDE_SUBDOMAINS = 'true';

      const config = loadTLSConfig();

      expect(config.enabled).toBe(true);
      expect(config.certPath).toBe('/cert.pem');
      expect(config.keyPath).toBe('/key.pem');
      expect(config.caPath).toBe('/ca.pem');
      expect(config.passphrase).toBe('secret');
      expect(config.minVersion).toBe('TLSv1.3');
      expect(config.redirectHttp).toBe(false);
      expect(config.httpPort).toBe(8080);
      expect(config.httpsPort).toBe(8443);
      expect(config.hsts).toBe(false);
      expect(config.hstsMaxAge).toBe(86400);
      expect(config.hstsIncludeSubDomains).toBe(true);
    });

    it('should use default values for optional settings', () => {
      process.env.TLS_ENABLED = 'true';
      const config = loadTLSConfig();

      expect(config.minVersion).toBe('TLSv1.2');
      expect(config.redirectHttp).toBe(true);
      expect(config.httpPort).toBe(80);
      expect(config.httpsPort).toBe(443);
      expect(config.hsts).toBe(true);
      expect(config.hstsMaxAge).toBe(31536000);
      expect(config.hstsIncludeSubDomains).toBe(false);
    });
  });

  describe('loadTLSOptions', () => {
    it('should return null when TLS is disabled', () => {
      const config: TLSConfig = { enabled: false };
      const options = loadTLSOptions(config);
      expect(options).toBeNull();
    });

    it('should return null when cert or key path is missing', () => {
      const config: TLSConfig = {
        enabled: true,
        certPath: '/nonexistent/cert.pem',
      };
      const options = loadTLSOptions(config);
      expect(options).toBeNull();
    });

    it('should return null when certificate files do not exist', () => {
      const config: TLSConfig = {
        enabled: true,
        certPath: '/nonexistent/cert.pem',
        keyPath: '/nonexistent/key.pem',
      };
      const options = loadTLSOptions(config);
      expect(options).toBeNull();
    });

    it('should load certificates when files exist', async () => {
      // Create temp cert files
      const fs = await import('fs');
      const os = await import('os');
      const path = await import('path');

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-test-'));
      const certPath = path.join(tmpDir, 'cert.pem');
      const keyPath = path.join(tmpDir, 'key.pem');

      fs.writeFileSync(certPath, '-----BEGIN CERTIFICATE-----\ntest cert\n-----END CERTIFICATE-----');
      fs.writeFileSync(keyPath, '-----BEGIN PRIVATE KEY-----\ntest key\n-----END PRIVATE KEY-----');

      try {
        const config: TLSConfig = {
          enabled: true,
          certPath,
          keyPath,
          minVersion: 'TLSv1.2',
        };

        const options = loadTLSOptions(config);

        expect(options).not.toBeNull();
        expect(options!.cert).toBeInstanceOf(Buffer);
        expect(options!.key).toBeInstanceOf(Buffer);
        expect(options!.minVersion).toBe('TLSv1.2');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should load optional CA certificate', async () => {
      const fs = await import('fs');
      const os = await import('os');
      const path = await import('path');

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-test-'));
      const certPath = path.join(tmpDir, 'cert.pem');
      const keyPath = path.join(tmpDir, 'key.pem');
      const caPath = path.join(tmpDir, 'ca.pem');

      fs.writeFileSync(certPath, 'cert');
      fs.writeFileSync(keyPath, 'key');
      fs.writeFileSync(caPath, 'ca cert');

      try {
        const config: TLSConfig = {
          enabled: true,
          certPath,
          keyPath,
          caPath,
        };

        const options = loadTLSOptions(config);
        expect(options!.ca).toBeInstanceOf(Buffer);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('isBehindProxy', () => {
    it('should return false when no proxy env vars are set', () => {
      expect(isBehindProxy()).toBe(false);
    });

    it('should return true when TRUST_PROXY is true', () => {
      process.env.TRUST_PROXY = 'true';
      expect(isBehindProxy()).toBe(true);
    });

    it('should return true when FORWARDED_PROTO is https', () => {
      process.env.FORWARDED_PROTO = 'https';
      expect(isBehindProxy()).toBe(true);
    });
  });

  describe('getPort', () => {
    it('should return HTTPS port when TLS is enabled', () => {
      const config: TLSConfig = {
        enabled: true,
        httpsPort: 8443,
      };
      expect(getPort(config)).toBe(8443);
    });

    it('should return PORT env var when TLS is disabled', () => {
      process.env.PORT = '3000';
      const config: TLSConfig = { enabled: false };
      expect(getPort(config)).toBe(3000);
    });

    it('should return default port 3100 when TLS is disabled and no PORT', () => {
      const config: TLSConfig = { enabled: false };
      expect(getPort(config)).toBe(3100);
    });
  });

  describe('createHSTSHeaderValue', () => {
    it('should return null when HSTS is disabled', () => {
      const config: TLSConfig = { enabled: true, hsts: false };
      expect(createHSTSHeaderValue(config)).toBeNull();
    });

    it('should return HSTS header with max-age', () => {
      const config: TLSConfig = {
        enabled: true,
        hsts: true,
        hstsMaxAge: 31536000,
      };
      expect(createHSTSHeaderValue(config)).toBe('max-age=31536000');
    });

    it('should include includeSubDomains when enabled', () => {
      const config: TLSConfig = {
        enabled: true,
        hsts: true,
        hstsMaxAge: 31536000,
        hstsIncludeSubDomains: true,
      };
      expect(createHSTSHeaderValue(config)).toBe('max-age=31536000; includeSubDomains');
    });
  });

  describe('getSecurityHeaders', () => {
    it('should return security headers without HSTS when disabled', () => {
      const config: TLSConfig = { enabled: true, hsts: false };
      const headers = getSecurityHeaders(config);

      expect(headers['Strict-Transport-Security']).toBeUndefined();
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
      expect(headers['X-Frame-Options']).toBe('DENY');
      expect(headers['X-XSS-Protection']).toBe('1; mode=block');
    });

    it('should return security headers with HSTS when enabled', () => {
      const config: TLSConfig = {
        enabled: true,
        hsts: true,
        hstsMaxAge: 31536000,
      };
      const headers = getSecurityHeaders(config);

      expect(headers['Strict-Transport-Security']).toBe('max-age=31536000');
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
      expect(headers['X-Frame-Options']).toBe('DENY');
      expect(headers['X-XSS-Protection']).toBe('1; mode=block');
    });
  });

  describe('DEFAULT_CIPHERS', () => {
    it('should include TLS 1.3 ciphers', () => {
      expect(DEFAULT_CIPHERS).toContain('TLS_AES_128_GCM_SHA256');
      expect(DEFAULT_CIPHERS).toContain('TLS_AES_256_GCM_SHA384');
      expect(DEFAULT_CIPHERS).toContain('TLS_CHACHA20_POLY1305_SHA256');
    });

    it('should include secure TLS 1.2 ciphers', () => {
      expect(DEFAULT_CIPHERS).toContain('ECDHE-RSA-AES128-GCM-SHA256');
      expect(DEFAULT_CIPHERS).toContain('ECDHE-RSA-AES256-GCM-SHA384');
    });

    it('should be colon-separated', () => {
      expect(DEFAULT_CIPHERS).toMatch(/^TLS_[A-Z0-9_]+:.+/);
    });
  });
});