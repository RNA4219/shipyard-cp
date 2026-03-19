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
import Fastify, { type FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import {
  loadTLSConfig,
  loadTLSOptions,
  getSecurityHeaders,
  type TLSConfig,
} from './tls/index.js';

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
  const host = process.env.HOST ?? '0.0.0.0';

  // Load TLS configuration
  const tlsConfig = loadTLSConfig();

  if (tlsConfig.enabled) {
    console.log('[Server] TLS mode enabled');

    // Load TLS options (certificates)
    const tlsOptions = loadTLSOptions(tlsConfig);

    if (!tlsOptions) {
      console.error('[Server] TLS enabled but certificates could not be loaded. Exiting.');
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

    // Create HTTPS server
    const httpsServer = https.createServer(tlsOptions, app.server);

    try {
      // Start HTTPS server
      await app.listen({ port: httpsPort, host });
      console.log(`[Server] HTTPS server listening on https://${host}:${httpsPort}`);

      // Start HTTP redirect server if enabled
      if (tlsConfig.redirectHttp && httpPort > 0) {
        const redirectServer = createRedirectServer(httpsPort, host);
        redirectServer.listen(httpPort, host, () => {
          console.log(`[Server] HTTP redirect server listening on http://${host}:${httpPort}`);
        });

        // Handle graceful shutdown for redirect server
        const shutdown = () => {
          console.log('[Server] Shutting down...');
          redirectServer.close(() => {
            console.log('[Server] HTTP redirect server closed');
          });
        };
        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
      }
    } catch (error) {
      app.log.error(error);
      process.exitCode = 1;
    }
  } else {
    // HTTP mode (no TLS)
    const port = Number.parseInt(process.env.PORT ?? '3000', 10);
    const app = await buildApp();

    try {
      await app.listen({ port, host });
      console.log(`[Server] HTTP server listening on http://${host}:${port}`);
    } catch (error) {
      app.log.error(error);
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error('[Server] Fatal error:', error);
  process.exitCode = 1;
});