/**
 * Shipyard Control Plane Server
 *
 * Supports both HTTP and HTTPS/TLS modes:
 * - HTTP mode (default): Standard HTTP server on configured port
 * - HTTPS mode: TLS-enabled server with automatic HTTP->HTTPS redirect
 *
 * TLS Configuration via environment variables:
 * - TLS_ENABLED: Enable TLS/HTTPS (auto-enabled if cert/key paths provided)
 * - TLS_CERT_PATH: Path to certificate file (PEM format)
 * - TLS_KEY_PATH: Path to private key file (PEM format)
 * - TLS_CA_PATH: Path to CA certificate (for mTLS)
 * - TLS_PASSPHRASE: Passphrase for encrypted private key
 * - TLS_MIN_VERSION: Minimum TLS version (TLSv1.2 or TLSv1.3)
 * - TLS_REDIRECT_HTTP: Enable HTTP->HTTPS redirect (default: true)
 * - HTTP_PORT: HTTP port for redirect (default: 80)
 * - HTTPS_PORT: HTTPS port (default: 443)
 * - TLS_HSTS: Enable HSTS header (default: true)
 */

import http from 'http';
import https from 'https';
import { buildApp } from './app.js';
import {
  loadTLSConfig,
  loadTLSOptions,
  getSecurityHeaders,
  type TLSConfig,
} from './tls/index.js';
import { getLogger } from './monitoring/index.js';

/**
 * Create HTTP server for redirect to HTTPS
 */
function createRedirectServer(httpsPort: number, host: string): http.Server {
  return http.createServer((req, res) => {
    const httpsUrl = `https://${req.headers.host?.split(':')[0] ?? host}:${httpsPort}${req.url}`;
    res.writeHead(301, {
      Location: httpsUrl,
      ...getSecurityHeaders({ hsts: true } as TLSConfig),
    });
    res.end(`Redirecting to ${httpsUrl}`);
  });
}

/**
 * Main entry point
 */
async function main() {
  const logger = getLogger().child({ component: 'Server' });
  const host = process.env.HOST ?? '0.0.0.0';

  // Load TLS configuration
  const tlsConfig = loadTLSConfig();

  if (tlsConfig.enabled) {
    logger.info('TLS mode enabled');

    // Load TLS options (certificates)
    const tlsOptions = loadTLSOptions(tlsConfig);

    if (!tlsOptions) {
      logger.error('TLS enabled but certificates could not be loaded. Exiting.');
      process.exitCode = 1;
      return;
    }

    // Determine HTTPS port
    const httpsPort = tlsConfig.httpsPort ?? 443;
    const httpPort = tlsConfig.httpPort ?? 80;

    // Build the app with TLS security headers middleware
    const app = await buildApp({
      logger: true,
      monitoring: { enabled: true },
    });

    // Add security headers hook
    app.addHook('onSend', async (request, reply) => {
      const headers = getSecurityHeaders(tlsConfig);
      for (const [key, value] of Object.entries(headers)) {
        reply.header(key, value);
      }
    });

    // Create HTTPS server with Fastify's request handler
    const httpsServer = https.createServer(tlsOptions, (req, res) => {
      app.server.emit('request', req, res);
    });

    try {
      // Start HTTPS server
      await new Promise<void>((resolve, reject) => {
        httpsServer.listen(httpsPort, host, () => {
          logger.info(`HTTPS server listening on https://${host}:${httpsPort}`);
          resolve();
        });
        httpsServer.on('error', reject);
      });

      // Start HTTP redirect server if enabled
      if (tlsConfig.redirectHttp && httpPort > 0) {
        const redirectServer = createRedirectServer(httpsPort, host);
        redirectServer.listen(httpPort, host, () => {
          logger.info(`HTTP redirect server listening on http://${host}:${httpPort}`);
        });

        // Handle graceful shutdown for both servers
        const shutdown = () => {
          logger.info('Shutting down...');
          httpsServer.close(() => {
            logger.info('HTTPS server closed');
          });
          redirectServer.close(() => {
            logger.info('HTTP redirect server closed');
          });
        };
        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
      } else {
        // Handle graceful shutdown for HTTPS server only
        const shutdown = () => {
          logger.info('Shutting down...');
          httpsServer.close(() => {
            logger.info('HTTPS server closed');
          });
        };
        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
      }
    } catch (error) {
      logger.error('Error starting server', { error });
      process.exitCode = 1;
    }
  } else {
    // HTTP mode (no TLS)
    const port = Number.parseInt(process.env.PORT ?? '3100', 10);
    const app = await buildApp();

    try {
      await app.listen({ port, host });
      logger.info(`HTTP server listening on http://${host}:${port}`);
    } catch (error) {
      app.log.error(error);
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  const logger = getLogger().child({ component: 'Server' });
  logger.error('Fatal error', { error });
  process.exitCode = 1;
});