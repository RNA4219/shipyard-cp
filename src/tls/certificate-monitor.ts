/**
 * TLS Certificate Monitor
 *
 * Monitors certificate expiry and sends alerts before expiration.
 * Can be run as a cron job or standalone service.
 *
 * Usage:
 *   // As a service
 *   const monitor = new CertificateMonitor({
 *     certPath: '/path/to/cert.pem',
 *     warningDays: 30,
 *     criticalDays: 7,
 *   });
 *   monitor.start();
 *
 *   // One-time check
 *   const status = await monitor.checkCertificate();
 */

import fs from 'fs';
import { spawn } from 'child_process';
import { getLogger } from '../monitoring/index.js';

const logger = getLogger();

export interface CertificateInfo {
  /** Subject CN */
  subject: string;
  /** Issuer CN */
  issuer: string;
  /** Serial number */
  serialNumber: string;
  /** Not valid before date */
  notBefore: Date;
  /** Not valid after date */
  notAfter: Date;
  /** Days until expiration */
  daysUntilExpiry: number;
  /** Certificate status */
  status: 'valid' | 'expiring_soon' | 'critical' | 'expired';
  /** SAN (Subject Alternative Names) */
  san: string[];
}

export interface MonitorConfig {
  /** Path to certificate file (PEM format) */
  certPath: string;
  /** Path to private key file (optional, for validation) */
  keyPath?: string;
  /** Days before expiry to send warning alert */
  warningDays: number;
  /** Days before expiry to send critical alert */
  criticalDays: number;
  /** Check interval in milliseconds */
  checkIntervalMs: number;
  /** Callback for warning alerts */
  onWarning?: (info: CertificateInfo) => Promise<void>;
  /** Callback for critical alerts */
  onCritical?: (info: CertificateInfo) => Promise<void>;
  /** Callback for expired certificates */
  onExpired?: (info: CertificateInfo) => Promise<void>;
}

export class CertificateMonitor {
  private config: MonitorConfig;
  private intervalId?: ReturnType<typeof setInterval>;
  private lastStatus?: CertificateInfo['status'];

  constructor(config: Partial<MonitorConfig> & { certPath: string }) {
    this.config = {
      warningDays: 30,
      criticalDays: 7,
      checkIntervalMs: 24 * 60 * 60 * 1000, // 24 hours
      ...config,
    };
  }

  /**
   * Start monitoring certificate.
   * Checks immediately and then at the configured interval.
   */
  start(): void {
    logger.info(`Starting certificate monitor for ${this.config.certPath}`);

    // Check immediately
    this.checkAndAlert();

    // Schedule periodic checks
    this.intervalId = setInterval(() => {
      this.checkAndAlert();
    }, this.config.checkIntervalMs);
  }

  /**
   * Stop monitoring.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      logger.info('Certificate monitor stopped');
    }
  }

  /**
   * Check certificate and send alerts if needed.
   */
  async checkAndAlert(): Promise<CertificateInfo> {
    try {
      const info = await this.checkCertificate();

      // Only alert if status changed
      if (info.status !== this.lastStatus) {
        this.lastStatus = info.status;

        switch (info.status) {
          case 'expired':
            logger.error(`Certificate expired on ${info.notAfter.toISOString()}`);
            if (this.config.onExpired) {
              await this.config.onExpired(info);
            }
            break;

          case 'critical':
            logger.error(`Certificate expires in ${info.daysUntilExpiry} days`);
            if (this.config.onCritical) {
              await this.config.onCritical(info);
            }
            break;

          case 'expiring_soon':
            logger.warn(`Certificate expires in ${info.daysUntilExpiry} days`);
            if (this.config.onWarning) {
              await this.config.onWarning(info);
            }
            break;

          case 'valid':
            logger.info(`Certificate is valid for ${info.daysUntilExpiry} more days`);
            break;
        }
      }

      return info;
    } catch (error) {
      logger.error(error instanceof Error ? error : new Error(String(error)), 'Certificate check failed');
      throw error;
    }
  }

  /**
   * Check certificate details.
   */
  async checkCertificate(): Promise<CertificateInfo> {
    const { certPath } = this.config;

    if (!fs.existsSync(certPath)) {
      throw new Error(`Certificate file not found: ${certPath}`);
    }

    const certContent = fs.readFileSync(certPath, 'utf8');

    // Parse certificate using openssl
    const info = await this.parseCertificate(certContent);

    // Calculate days until expiry
    const now = new Date();
    const msUntilExpiry = info.notAfter.getTime() - now.getTime();
    info.daysUntilExpiry = Math.floor(msUntilExpiry / (24 * 60 * 60 * 1000));

    // Determine status
    if (info.daysUntilExpiry <= 0) {
      info.status = 'expired';
    } else if (info.daysUntilExpiry <= this.config.criticalDays) {
      info.status = 'critical';
    } else if (info.daysUntilExpiry <= this.config.warningDays) {
      info.status = 'expiring_soon';
    } else {
      info.status = 'valid';
    }

    return info;
  }

  /**
   * Parse certificate using openssl.
   */
  private async parseCertificate(certContent: string): Promise<CertificateInfo> {
    return new Promise((resolve, reject) => {
      const openssl = spawn('openssl', ['x509', '-noout', '-text']);

      let output = '';
      let error = '';

      openssl.stdin.write(certContent);
      openssl.stdin.end();

      openssl.stdout.on('data', (data) => {
        output += data.toString();
      });

      openssl.stderr.on('data', (data) => {
        error += data.toString();
      });

      openssl.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`openssl failed: ${error}`));
          return;
        }

        try {
          const info = this.parseOpenSSLOutput(output);
          resolve(info);
        } catch (parseError) {
          reject(parseError);
        }
      });
    });
  }

  /**
   * Parse openssl output to extract certificate info.
   */
  private parseOpenSSLOutput(output: string): CertificateInfo {
    const info: CertificateInfo = {
      subject: '',
      issuer: '',
      serialNumber: '',
      notBefore: new Date(),
      notAfter: new Date(),
      daysUntilExpiry: 0,
      status: 'valid',
      san: [],
    };

    // Extract subject
    const subjectMatch = output.match(/Subject:\s*(.+)/);
    if (subjectMatch) {
      const cnMatch = subjectMatch[1].match(/CN\s*=\s*([^,\n]+)/);
      info.subject = cnMatch ? cnMatch[1].trim() : subjectMatch[1].trim();
    }

    // Extract issuer
    const issuerMatch = output.match(/Issuer:\s*(.+)/);
    if (issuerMatch) {
      const cnMatch = issuerMatch[1].match(/CN\s*=\s*([^,\n]+)/);
      info.issuer = cnMatch ? cnMatch[1].trim() : issuerMatch[1].trim();
    }

    // Extract serial number
    const serialMatch = output.match(/Serial Number:\s*([a-fA-F0-9:\s]+)/);
    if (serialMatch) {
      info.serialNumber = serialMatch[1].trim();
    }

    // Extract validity dates
    const notBeforeMatch = output.match(/Not Before:\s*(.+)/);
    if (notBeforeMatch) {
      info.notBefore = new Date(notBeforeMatch[1].trim());
    }

    const notAfterMatch = output.match(/Not After\s*:\s*(.+)/);
    if (notAfterMatch) {
      info.notAfter = new Date(notAfterMatch[1].trim());
    }

    // Extract SAN
    const sanMatch = output.match(/Subject Alternative Name:\s*\n?\s*(.+)/);
    if (sanMatch) {
      info.san = sanMatch[1].split(',').map((s) => s.trim());
    }

    return info;
  }

  /**
   * Validate that the private key matches the certificate.
   */
  async validateKeyMatch(): Promise<boolean> {
    if (!this.config.keyPath) {
      throw new Error('Key path not configured');
    }

    const certContent = fs.readFileSync(this.config.certPath, 'utf8');
    const keyContent = fs.readFileSync(this.config.keyPath, 'utf8');

    // Extract modulus from certificate
    const certModulus = await this.getModulus(certContent, 'cert');
    const keyModulus = await this.getModulus(keyContent, 'key');

    return certModulus === keyModulus;
  }

  private async getModulus(content: string, type: 'cert' | 'key'): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = type === 'cert'
        ? ['x509', '-noout', '-modulus']
        : ['rsa', '-noout', '-modulus'];

      const openssl = spawn('openssl', args);

      let output = '';
      let error = '';

      openssl.stdin.write(content);
      openssl.stdin.end();

      openssl.stdout.on('data', (data) => {
        output += data.toString();
      });

      openssl.stderr.on('data', (data) => {
        error += data.toString();
      });

      openssl.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`openssl failed: ${error}`));
          return;
        }
        resolve(output.trim());
      });
    });
  }
}

/**
 * Create alert handlers for common notification services.
 */
export function createSlackAlertHandler(webhookUrl: string): (info: CertificateInfo) => Promise<void> {
  return async (info: CertificateInfo) => {
    const severity = info.status === 'critical' ? 'danger' : 'warning';
    const color = info.status === 'critical' ? '#FF0000' : '#FFA500';

    const payload = {
      attachments: [{
        color,
        title: `TLS Certificate ${info.status.toUpperCase()}`,
        fields: [
          { title: 'Severity', value: severity, short: true },
          { title: 'Subject', value: info.subject, short: true },
          { title: 'Days Until Expiry', value: String(info.daysUntilExpiry), short: true },
          { title: 'Expires', value: info.notAfter.toISOString(), short: false },
          { title: 'Issuer', value: info.issuer, short: true },
        ],
      }],
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Slack webhook failed: ${response.status}`);
    }
  };
}

export function createEmailAlertHandler(
  sendEmail: (subject: string, body: string) => Promise<void>
): (info: CertificateInfo) => Promise<void> {
  return async (info: CertificateInfo) => {
    const subject = `[${info.status.toUpperCase()}] TLS Certificate Alert: ${info.subject}`;
    const body = `
TLS Certificate ${info.status}:

Subject: ${info.subject}
Issuer: ${info.issuer}
Expires: ${info.notAfter.toISOString()}
Days Until Expiry: ${info.daysUntilExpiry}

Please renew the certificate immediately.
    `.trim();

    await sendEmail(subject, body);
  };
}