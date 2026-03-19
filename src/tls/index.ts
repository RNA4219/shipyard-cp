/**
 * TLS Configuration Module
 *
 * Exports for HTTPS/TLS configuration and security headers.
 */

export {
  type TLSConfig,
  type TLSOptions,
  loadTLSConfig,
  loadTLSOptions,
  generateSelfSignedCert,
  isBehindProxy,
  getPort,
  createHSTSHeaderValue,
  DEFAULT_CIPHERS,
  getSecurityHeaders,
} from './tls-config.js';

export {
  type CertificateInfo,
  type MonitorConfig,
  CertificateMonitor,
  createSlackAlertHandler,
  createEmailAlertHandler,
} from './certificate-monitor.js';