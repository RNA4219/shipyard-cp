/**
 * Tests for TLS Certificate Monitor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CertificateMonitor, createSlackAlertHandler } from '../src/tls/certificate-monitor.js';
import fs from 'fs';
import { spawn } from 'child_process';

// Mock fs and child_process
vi.mock('fs');
vi.mock('child_process');

describe('CertificateMonitor', () => {
  let monitor: CertificateMonitor;
  const mockCertPath = '/path/to/cert.pem';

  // Sample certificate info
  const sampleCertInfo = {
    subject: 'example.com',
    issuer: "Let's Encrypt Authority X3",
    serialNumber: '1234567890ABCDEF',
    notBefore: new Date('2025-01-01T00:00:00Z'),
    notAfter: new Date('2025-04-01T00:00:00Z'),
    daysUntilExpiry: 60,
    status: 'valid' as const,
    san: ['example.com', 'www.example.com'],
  };

  beforeEach(() => {
    vi.resetAllMocks();

    // Mock fs.existsSync
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('mock-cert-content');

    // Mock spawn for openssl
    const mockSpawn = vi.fn().mockImplementation(() => {
      const mockProcess = {
        stdin: {
          write: vi.fn(),
          end: vi.fn(),
        },
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === 'data') {
              callback(Buffer.from(`
Subject: CN = example.com
Issuer: CN = Let's Encrypt Authority X3
Serial Number: 1234567890ABCDEF
Not Before: Jan  1 00:00:00 2025 GMT
Not After : Apr  1 00:00:00 2025 GMT
Subject Alternative Name:
    DNS:example.com, DNS:www.example.com
              `));
            }
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === 'close') {
            callback(0); // Success exit code
          }
        }),
      };
      return mockProcess;
    });

    vi.mocked(spawn).mockImplementation(mockSpawn);
  });

  afterEach(() => {
    if (monitor) {
      monitor.stop();
    }
  });

  describe('constructor', () => {
    it('should create monitor with default config', () => {
      monitor = new CertificateMonitor({ certPath: mockCertPath });
      expect(monitor).toBeDefined();
    });

    it('should accept custom config', () => {
      monitor = new CertificateMonitor({
        certPath: mockCertPath,
        warningDays: 45,
        criticalDays: 14,
        checkIntervalMs: 60000,
      });
      expect(monitor).toBeDefined();
    });
  });

  describe('checkCertificate', () => {
    it('should throw if certificate file not found', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      monitor = new CertificateMonitor({ certPath: '/nonexistent/cert.pem' });

      await expect(monitor.checkCertificate()).rejects.toThrow('Certificate file not found');
    });

    it('should return certificate info for valid certificate', async () => {
      // Set notAfter to 60 days from now
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 60);

      vi.mocked(spawn).mockImplementation(() => {
        const mockProcess = {
          stdin: { write: vi.fn(), end: vi.fn() },
          stdout: {
            on: vi.fn((event, callback) => {
              if (event === 'data') {
                callback(Buffer.from(`
Subject: CN = example.com
Issuer: CN = Let's Encrypt Authority X3
Not After : ${futureDate.toDateString()} 00:00:00 2025 GMT
                `));
              }
            }),
          },
          stderr: { on: vi.fn() },
          on: vi.fn((event, callback) => {
            if (event === 'close') callback(0);
          }),
        };
        return mockProcess;
      });

      monitor = new CertificateMonitor({ certPath: mockCertPath });
      const info = await monitor.checkCertificate();

      expect(info.subject).toContain('example.com');
      expect(info.status).toBe('valid');
      expect(info.daysUntilExpiry).toBeGreaterThan(0);
    });

    it('should detect expiring certificate', async () => {
      // Set notAfter to 20 days from now
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 20);

      vi.mocked(spawn).mockImplementation(() => {
        const mockProcess = {
          stdin: { write: vi.fn(), end: vi.fn() },
          stdout: {
            on: vi.fn((event, callback) => {
              if (event === 'data') {
                callback(Buffer.from(`
Subject: CN = example.com
Not After : ${futureDate.toDateString()} 00:00:00 2025 GMT
                `));
              }
            }),
          },
          stderr: { on: vi.fn() },
          on: vi.fn((event, callback) => {
            if (event === 'close') callback(0);
          }),
        };
        return mockProcess;
      });

      monitor = new CertificateMonitor({
        certPath: mockCertPath,
        warningDays: 30,
        criticalDays: 7,
      });
      const info = await monitor.checkCertificate();

      expect(info.status).toBe('expiring_soon');
    });

    it('should detect critical certificate', async () => {
      // Set notAfter to 5 days from now
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);

      vi.mocked(spawn).mockImplementation(() => {
        const mockProcess = {
          stdin: { write: vi.fn(), end: vi.fn() },
          stdout: {
            on: vi.fn((event, callback) => {
              if (event === 'data') {
                callback(Buffer.from(`
Subject: CN = example.com
Not After : ${futureDate.toDateString()} 00:00:00 2025 GMT
                `));
              }
            }),
          },
          stderr: { on: vi.fn() },
          on: vi.fn((event, callback) => {
            if (event === 'close') callback(0);
          }),
        };
        return mockProcess;
      });

      monitor = new CertificateMonitor({
        certPath: mockCertPath,
        criticalDays: 7,
      });
      const info = await monitor.checkCertificate();

      expect(info.status).toBe('critical');
    });

    it('should detect expired certificate', async () => {
      // Set notAfter to 5 days ago
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 5);

      vi.mocked(spawn).mockImplementation(() => {
        const mockProcess = {
          stdin: { write: vi.fn(), end: vi.fn() },
          stdout: {
            on: vi.fn((event, callback) => {
              if (event === 'data') {
                callback(Buffer.from(`
Subject: CN = example.com
Not After : ${pastDate.toDateString()} 00:00:00 2025 GMT
                `));
              }
            }),
          },
          stderr: { on: vi.fn() },
          on: vi.fn((event, callback) => {
            if (event === 'close') callback(0);
          }),
        };
        return mockProcess;
      });

      monitor = new CertificateMonitor({ certPath: mockCertPath });
      const info = await monitor.checkCertificate();

      expect(info.status).toBe('expired');
      expect(info.daysUntilExpiry).toBeLessThan(0);
    });
  });

  describe('start/stop', () => {
    it('should start and stop monitoring', () => {
      monitor = new CertificateMonitor({
        certPath: mockCertPath,
        checkIntervalMs: 1000,
      });

      monitor.start();
      // Should have started interval

      monitor.stop();
      // Should have cleared interval
    });
  });

  describe('checkAndAlert', () => {
    it('should call onWarning callback for expiring certificate', async () => {
      const onWarning = vi.fn();
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 20);

      vi.mocked(spawn).mockImplementation(() => {
        const mockProcess = {
          stdin: { write: vi.fn(), end: vi.fn() },
          stdout: {
            on: vi.fn((event, callback) => {
              if (event === 'data') {
                callback(Buffer.from(`
Subject: CN = example.com
Not After : ${futureDate.toDateString()} 00:00:00 2025 GMT
                `));
              }
            }),
          },
          stderr: { on: vi.fn() },
          on: vi.fn((event, callback) => {
            if (event === 'close') callback(0);
          }),
        };
        return mockProcess;
      });

      monitor = new CertificateMonitor({
        certPath: mockCertPath,
        warningDays: 30,
        onWarning,
      });

      await monitor.checkAndAlert();
      expect(onWarning).toHaveBeenCalled();
    });

    it('should call onCritical callback for critical certificate', async () => {
      const onCritical = vi.fn();
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 3);

      vi.mocked(spawn).mockImplementation(() => {
        const mockProcess = {
          stdin: { write: vi.fn(), end: vi.fn() },
          stdout: {
            on: vi.fn((event, callback) => {
              if (event === 'data') {
                callback(Buffer.from(`
Subject: CN = example.com
Not After : ${futureDate.toDateString()} 00:00:00 2025 GMT
                `));
              }
            }),
          },
          stderr: { on: vi.fn() },
          on: vi.fn((event, callback) => {
            if (event === 'close') callback(0);
          }),
        };
        return mockProcess;
      });

      monitor = new CertificateMonitor({
        certPath: mockCertPath,
        criticalDays: 7,
        onCritical,
      });

      await monitor.checkAndAlert();
      expect(onCritical).toHaveBeenCalled();
    });
  });
});

describe('createSlackAlertHandler', () => {
  it('should create a Slack alert handler', () => {
    const handler = createSlackAlertHandler('https://hooks.slack.com/services/test');
    expect(typeof handler).toBe('function');
  });

  it('should send alert to Slack', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch;

    const handler = createSlackAlertHandler('https://hooks.slack.com/services/test');

    await handler({
      subject: 'example.com',
      issuer: "Let's Encrypt",
      serialNumber: '123',
      notBefore: new Date(),
      notAfter: new Date(),
      daysUntilExpiry: 5,
      status: 'critical',
      san: ['example.com'],
    });

    expect(mockFetch).toHaveBeenCalled();
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.attachments[0].title).toContain('CRITICAL');
  });
});