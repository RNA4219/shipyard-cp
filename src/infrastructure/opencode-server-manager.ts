/**
 * OpenCode Server Manager
 *
 * Manages `opencode serve` process lifecycle: startup, health check, and shutdown.
 */

import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { OpenCodeServeConfig } from '../config/index.js';
import { getLogger } from '../monitoring/index.js';

export interface ServerManagerConfig {
  /** OpenCode serve path (binary) */
  servePath: string;
  /** Base URL for the serve API */
  baseUrl: string;
  /** Startup timeout in milliseconds */
  startupTimeout: number;
  /** Working directory for server files */
  workDir?: string;
  /** Server port (extracted from baseUrl) */
  port?: number;
  /** Enable debug logging */
  debug?: boolean;
}

export interface ServerStatus {
  /** Server is running and healthy */
  healthy: boolean;
  /** Server process PID */
  pid?: number;
  /** Server base URL */
  baseUrl: string;
  /** Server startup timestamp */
  startedAt?: number;
  /** Last health check timestamp */
  lastHealthCheck?: number;
  /** Error message if unhealthy */
  error?: string;
}

export class OpenCodeServerManager {
  private readonly logger = getLogger().child({ component: 'OpenCodeServerManager' });
  private process: ChildProcess | null = null;
  private status: ServerStatus;
  private readonly config: Required<ServerManagerConfig>;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(config: ServerManagerConfig) {
    this.config = {
      servePath: config.servePath,
      baseUrl: config.baseUrl,
      startupTimeout: config.startupTimeout,
      workDir: config.workDir || '/tmp/shipyard-opencode-serve',
      port: config.port || this.extractPort(config.baseUrl),
      debug: config.debug || false,
    };

    this.status = {
      healthy: false,
      baseUrl: this.config.baseUrl,
    };

    void this.ensureWorkDir();
  }

  /**
   * Start the opencode serve process.
   * Returns true if server started successfully and is healthy.
   */
  async start(): Promise<boolean> {
    if (this.process && this.status.healthy) {
      this.logger.info('Server already running', { pid: this.process.pid });
      return true;
    }

    if (this.process) {
      this.logger.warn('Server process exists but unhealthy, restarting');
      await this.stop();
    }

    this.logger.info('Starting opencode serve', {
      servePath: this.config.servePath,
      baseUrl: this.config.baseUrl,
      port: this.config.port,
    });

    const logPath = path.join(this.config.workDir, 'server.log');
    const configPath = path.join(this.config.workDir, 'serve-config.json');

    // Write server config
    await writeFile(configPath, JSON.stringify({
      port: this.config.port,
      baseUrl: this.config.baseUrl,
    }, null, 2), 'utf8');

    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }

    // Start server process
    this.process = spawn(this.config.servePath, ['serve'], {
      cwd: this.config.workDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    const startedAt = Date.now();
    this.status.startedAt = startedAt;

    // Collect stdout/stderr for debugging
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    this.process.stdout?.on('data', (data) => {
      const text = data.toString();
      stdoutChunks.push(text);
      if (this.config.debug) {
        this.logger.debug('Server stdout', { data: text });
      }
    });

    this.process.stderr?.on('data', (data) => {
      const text = data.toString();
      stderrChunks.push(text);
      if (this.config.debug) {
        this.logger.debug('Server stderr', { data: text });
      }
    });

    this.process.on('error', (error) => {
      this.logger.error('Server process error', { error: error.message });
      this.status.healthy = false;
      this.status.error = error.message;
    });

    this.process.on('close', (code) => {
      this.logger.info('Server process closed', { code });
      this.status.healthy = false;
      this.status.pid = undefined;

      // Write logs on close
      void writeFile(logPath, stdoutChunks.join('\n') + '\n\n--- STDERR ---\n' + stderrChunks.join('\n'), 'utf8');
    });

    this.status.pid = this.process.pid;

    // Wait for server to be ready
    const ready = await this.waitForReady(startedAt);

    if (ready) {
      this.logger.info('Server started successfully', { pid: this.process.pid });
      this.startHealthChecks();
      return true;
    } else {
      this.logger.error('Server failed to start within timeout');
      await this.stop();
      return false;
    }
  }

  /**
   * Stop the opencode serve process.
   */
  async stop(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (!this.process) {
      this.logger.info('No server process to stop');
      return;
    }

    // Check if process is still alive
    if (this.process.killed) {
      this.logger.info('Server process already killed');
      this.process = null;
      return;
    }

    this.logger.info('Stopping opencode serve', { pid: this.process.pid });

    // Send SIGTERM first (Windows uses SIGKILL equivalent)
    try {
      this.process.kill('SIGTERM');
    } catch {
      // On Windows, SIGTERM may not work - try SIGKILL
      try {
        this.process.kill('SIGKILL');
      } catch {
        // Process may already be dead
      }
    }

    // Wait for graceful shutdown (max 5 seconds)
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.logger.warn('Force killing server process');
          try {
            this.process.kill('SIGKILL');
          } catch {
            // Ignore kill errors
          }
        }
        resolve();
      }, 5000);

      this.process?.on('close', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.process = null;
    this.status.healthy = false;
    this.status.pid = undefined;
    this.status.error = undefined;
  }

  /**
   * Check if server is healthy.
   */
  async healthCheck(): Promise<boolean> {
    if (!this.process) {
      this.status.healthy = false;
      this.status.error = 'No server process';
      return false;
    }

    try {
      // HTTP health check
      const response = await fetch(`${this.config.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      const healthy = response.ok;
      this.status.healthy = healthy;
      this.status.lastHealthCheck = Date.now();

      if (!healthy) {
        this.status.error = `Health check returned ${response.status}`;
      } else {
        this.status.error = undefined;
      }

      return healthy;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('Health check failed', { error: message });
      this.status.healthy = false;
      this.status.error = message;
      return false;
    }
  }

  /**
   * Get current server status.
   */
  getStatus(): ServerStatus {
    return { ...this.status };
  }

  /**
   * Ensure server is ready, starting if necessary.
   */
  async ensureServerReady(): Promise<boolean> {
    if (this.status.healthy && this.process) {
      return true;
    }

    // Try health check first if process exists
    if (this.process) {
      const healthy = await this.healthCheck();
      if (healthy) {
        return true;
      }
    }

    // Start server
    return await this.start();
  }

  private async waitForReady(startedAt: number): Promise<boolean> {
    const timeout = this.config.startupTimeout;
    const checkInterval = 1000;

    while (Date.now() - startedAt < timeout) {
      try {
        const response = await fetch(`${this.config.baseUrl}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(checkInterval),
        });

        if (response.ok) {
          this.status.healthy = true;
          this.status.lastHealthCheck = Date.now();
          return true;
        }
      } catch {
        // Server not ready yet, continue waiting
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    return false;
  }

  private startHealthChecks(): void {
    // Health check every 30 seconds
    this.healthCheckInterval = setInterval(() => {
      void this.healthCheck();
    }, 30000);
  }

  private extractPort(baseUrl: string): number {
    try {
      const url = new URL(baseUrl);
      return parseInt(url.port, 10) || 3001;
    } catch {
      return 3001;
    }
  }

  private async ensureWorkDir(): Promise<void> {
    if (!existsSync(this.config.workDir)) {
      await mkdir(this.config.workDir, { recursive: true });
    }
  }
}

/**
 * Create a server manager from config.
 */
export function createOpenCodeServerManager(config: OpenCodeServeConfig, debug?: boolean): OpenCodeServerManager {
  return new OpenCodeServerManager({
    servePath: config.servePath,
    baseUrl: config.serveBaseUrl,
    startupTimeout: config.serverStartupTimeoutMs,
    debug,
  });
}