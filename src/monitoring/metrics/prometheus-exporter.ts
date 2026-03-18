/**
 * Prometheus Exporter for Shipyard Control Plane
 *
 * Exports metrics in Prometheus/OpenMetrics format for scraping.
 */

import type { Registry } from 'prom-client';
import { MetricsCollector, getMetricsCollector } from './metrics-collector.js';

/**
 * Prometheus Exporter configuration
 */
export interface PrometheusExporterConfig {
  /** Metrics collector instance */
  collector?: MetricsCollector;
  /** Custom endpoint path */
  endpoint?: string;
}

/**
 * Prometheus Exporter class
 *
 * Provides metrics export functionality for Prometheus scraping.
 */
export class PrometheusExporter {
  private readonly collector: MetricsCollector;
  private readonly endpoint: string;

  constructor(config: PrometheusExporterConfig = {}) {
    this.collector = config.collector ?? getMetricsCollector();
    this.endpoint = config.endpoint ?? '/metrics';
  }

  /**
   * Get the metrics endpoint path
   */
  getEndpoint(): string {
    return this.endpoint;
  }

  /**
   * Get the metrics registry
   */
  getRegistry(): Registry {
    return this.collector.getRegistry();
  }

  /**
   * Export metrics in Prometheus text format
   */
  async export(): Promise<string> {
    return this.collector.export();
  }

  /**
   * Export metrics as JSON
   */
  async exportJson(): Promise<unknown[]> {
    return this.collector.exportJson();
  }

  /**
   * Get the Content-Type for the metrics response
   */
  getContentType(): string {
    return this.collector.getContentType();
  }

  /**
   * Export metrics in OpenMetrics format
   */
  async exportOpenMetrics(): Promise<string> {
    const metrics = await this.export();
    // Add OpenMetrics content type header if not already present
    if (!metrics.includes('# EOF')) {
      return `${metrics}\n# EOF\n`;
    }
    return metrics;
  }

  /**
   * Get the metrics collector
   */
  getCollector(): MetricsCollector {
    return this.collector;
  }

  /**
   * Create a response object for HTTP servers
   */
  async createResponse(): Promise<{ body: string; contentType: string }> {
    const body = await this.exportOpenMetrics();
    const contentType = 'application/openmetrics-text; version=1.0.0; charset=utf-8';
    return { body, contentType };
  }
}

// -----------------------------------------------------------------------------
// Global Instance
// -----------------------------------------------------------------------------

let globalExporter: PrometheusExporter | null = null;

/**
 * Initialize the global Prometheus exporter
 */
export function initializePrometheusExporter(config?: PrometheusExporterConfig): PrometheusExporter {
  globalExporter = new PrometheusExporter(config);
  return globalExporter;
}

/**
 * Get the global Prometheus exporter
 */
export function getPrometheusExporter(): PrometheusExporter {
  if (!globalExporter) {
    globalExporter = new PrometheusExporter();
  }
  return globalExporter;
}

/**
 * Reset the global Prometheus exporter (useful for testing)
 */
export function resetPrometheusExporter(): void {
  globalExporter = null;
}