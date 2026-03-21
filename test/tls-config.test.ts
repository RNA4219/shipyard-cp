import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadTLSConfig,
  loadTLSOptions,
  isBehindProxy,
  getPort,
  createHSTSHeaderValue,
  getSecurityHeaders,
  type TLSConfig,
} from '../src/tls/tls-config.js';
import fs from 'fs';

// Mock fs module
vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(),
  },
}));

describe('TLS Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadTLSConfig', () => {
    it('should load config from environment variables', () => {
      process.env.TLS_ENABLED = 'true';
      process.env.TLS_CERT_PATH = '/path/to/cert.pem';
      process.env.TLS_KEY_PATH = '/path/to/key.pem';

      const config = loadTLSConfig();

      expect(config.enabled).toBe(true);
      expect(config.certPath).toBe('/path/to/cert.pem');
      expect(config.keyPath).toBe('/path/to/key.pem');
    });

    it('should auto-enable TLS when cert and key paths are set', () => {
      delete process.env.TLS_ENABLED;
      process.env.TLS_CERT_PATH = '/path/to/cert.pem';
      process.env.TLS_KEY_PATH = '/path/to/key.pem';

      const config = loadTLSConfig();

      expect(config.enabled).toBe(true);
    });

    it('should use default values when not set', () => {
      delete process.env.TLS_ENABLED;
      delete process.env.TLS_CERT_PATH;
      delete process.env.TLS_KEY_PATH;

      const config = loadTLSConfig();

      expect(config.enabled).toBe(false);
      expect(config.minVersion).toBe('TLSv1.2');
      expect(config.hsts).toBe(true);
    });
  });

  describe('loadTLSOptions', () => {
    it('should return null when TLS is disabled', () => {
      const config = { enabled: false };
      expect(loadTLSOptions(config)).toBeNull();
    });

    it('should return null when cert or key path is missing', () => {
      const config = { enabled: true, certPath: undefined, keyPath: '/path/to/key.pem' };
      expect(loadTLSOptions(config)).toBeNull();
    });

    it('should load TLS options successfully', () => {
      const mockCert = Buffer.from('mock cert content');
      const mockKey = Buffer.from('mock key content');

      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        if (p.includes('cert')) return mockCert;
        if (p.includes('key')) return mockKey;
        return Buffer.from('');
      });

      const config = {
        enabled: true,
        certPath: '/path/to/cert.pem',
        keyPath: '/path/to/key.pem',
        minVersion: 'TLSv1.3',
      };

      const options = loadTLSOptions(config);

      expect(options).not.toBeNull();
      expect(options?.cert).toBe(mockCert);
      expect(options?.key).toBe(mockKey);
    });

    it('should return null on file read error', () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('File not found');
      });

      const config = {
        enabled: true,
        certPath: '/nonexistent/cert.pem',
        keyPath: '/nonexistent/key.pem',
      };

      expect(loadTLSOptions(config)).toBeNull();
    });
  });

  describe('isBehindProxy', () => {
    it('should return true when TRUST_PROXY is true', () => {
      process.env.TRUST_PROXY = 'true';
      expect(isBehindProxy()).toBe(true);
    });

    it('should return false when not set', () => {
      delete process.env.TRUST_PROXY;
      delete process.env.FORWARDED_PROTO;
      expect(isBehindProxy()).toBe(false);
    });
  });

  describe('getPort', () => {
    it('should return HTTPS port when TLS is enabled', () => {
      const config = { enabled: true, httpsPort: 8443 };
      expect(getPort(config)).toBe(8443);
    });

    it('should return PORT env when TLS is disabled', () => {
      process.env.PORT = '3000';
      expect(getPort({ enabled: false })).toBe(3000);
    });
  });

  describe('createHSTSHeaderValue', () => {
    it('should return null when HSTS is disabled', () => {
      expect(createHSTSHeaderValue({ enabled: true, hsts: false })).toBeNull();
    });

    it('should create HSTS value', () => {
      const config = { enabled: true, hsts: true, hstsMaxAge: 86400, hstsIncludeSubDomains: false };
      expect(createHSTSHeaderValue(config)).toBe('max-age=86400');
    });

    it('should include subdomains', () => {
      const config = { enabled: true, hsts: true, hstsMaxAge: 31536000, hstsIncludeSubDomains: true };
      expect(createHSTSHeaderValue(config)).toBe('max-age=31536000; includeSubDomains');
    });
  });

  describe('getSecurityHeaders', () => {
    it('should return all security headers', () => {
      const config = { enabled: true, hsts: true, hstsMaxAge: 31536000, hstsIncludeSubDomains: true };
      const headers = getSecurityHeaders(config);

      expect(headers['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
      expect(headers['X-Frame-Options']).toBe('DENY');
      expect(headers['X-XSS-Protection']).toBe('1; mode=block');
    });

    it('should return headers without HSTS when disabled', () => {
      const headers = getSecurityHeaders({ enabled: true, hsts: false });

      expect(headers['Strict-Transport-Security']).toBeUndefined();
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
    });
  });
});
