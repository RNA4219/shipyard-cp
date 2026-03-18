import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  PrometheusExporter,
  initializePrometheusExporter,
  getPrometheusExporter,
  resetPrometheusExporter,
} from '../../src/monitoring/metrics/prometheus-exporter.js';
import {
  MetricsCollector,
  resetMetricsCollector,
} from '../../src/monitoring/metrics/metrics-collector.js';

describe('PrometheusExporter', () => {
  let exporter: PrometheusExporter;
  let collector: MetricsCollector;

  beforeEach(() => {
    resetMetricsCollector();
    resetPrometheusExporter();
    collector = new MetricsCollector({
      prefix: 'test_',
      enableDefaultMetrics: false,
    });
    exporter = new PrometheusExporter({ collector });
  });

  afterEach(() => {
    resetMetricsCollector();
    resetPrometheusExporter();
  });

  describe('constructor', () => {
    it('should create an exporter with default configuration', () => {
      const testExporter = new PrometheusExporter();
      expect(testExporter).toBeDefined();
      expect(testExporter.getEndpoint()).toBe('/metrics');
    });

    it('should create an exporter with custom endpoint', () => {
      const testExporter = new PrometheusExporter({ endpoint: '/custom-metrics' });
      expect(testExporter.getEndpoint()).toBe('/custom-metrics');
    });

    it('should accept a custom collector', () => {
      const customCollector = new MetricsCollector({ prefix: 'custom_' });
      const testExporter = new PrometheusExporter({ collector: customCollector });
      expect(testExporter.getCollector()).toBe(customCollector);
    });
  });

  describe('export', () => {
    it('should export metrics in Prometheus format', async () => {
      collector.incrementTasksTotal('queued');
      const metrics = await exporter.export();

      expect(typeof metrics).toBe('string');
      expect(metrics).toContain('# HELP');
      expect(metrics).toContain('# TYPE');
      expect(metrics).toContain('test_tasks_total');
    });

    it('should include job metrics', async () => {
      collector.recordJobCreation('dev', 'codex');
      const metrics = await exporter.export();

      expect(metrics).toContain('test_jobs_total');
      expect(metrics).toContain('stage="dev"');
      expect(metrics).toContain('worker_type="codex"');
    });

    it('should include dispatch metrics', async () => {
      collector.recordDispatch('plan');
      const metrics = await exporter.export();

      expect(metrics).toContain('test_dispatch_total');
      expect(metrics).toContain('stage="plan"');
    });

    it('should include result metrics', async () => {
      collector.recordResult('succeeded');
      collector.recordResult('failed');
      const metrics = await exporter.export();

      expect(metrics).toContain('test_result_total');
      expect(metrics).toContain('status="succeeded"');
      expect(metrics).toContain('status="failed"');
    });
  });

  describe('exportJson', () => {
    it('should export metrics as JSON', async () => {
      collector.incrementTasksTotal('queued');
      const json = await exporter.exportJson();

      expect(typeof json).toBe('object');
      expect(Array.isArray(json)).toBe(true);
    });

    it('should include metric names in JSON export', async () => {
      collector.incrementTasksTotal('queued');
      collector.recordJobCreation('dev', 'codex');
      const json = await exporter.exportJson() as Array<{ name: string }>;

      const names = json.map(m => m.name);
      expect(names).toContain('test_tasks_total');
      expect(names).toContain('test_jobs_total');
    });
  });

  describe('exportOpenMetrics', () => {
    it('should export in OpenMetrics format with EOF marker', async () => {
      collector.incrementTasksTotal('queued');
      const metrics = await exporter.exportOpenMetrics();

      expect(metrics).toContain('# EOF');
    });

    it('should not duplicate EOF marker if already present', async () => {
      collector.incrementTasksTotal('queued');
      const metrics1 = await exporter.exportOpenMetrics();
      // Export again to check no duplication
      const metrics2 = await exporter.exportOpenMetrics();

      const eofCount = (metrics2.match(/# EOF/g) || []).length;
      expect(eofCount).toBeLessThanOrEqual(1);
    });
  });

  describe('getContentType', () => {
    it('should return the content type from registry', () => {
      const contentType = exporter.getContentType();
      expect(contentType).toContain('text/plain');
    });
  });

  describe('getRegistry', () => {
    it('should return the collector registry', () => {
      const registry = exporter.getRegistry();
      expect(registry).toBeDefined();
    });
  });

  describe('createResponse', () => {
    it('should create a response object for HTTP servers', async () => {
      collector.incrementTasksTotal('queued');
      const response = await exporter.createResponse();

      expect(response).toHaveProperty('body');
      expect(response).toHaveProperty('contentType');
      expect(typeof response.body).toBe('string');
      expect(response.contentType).toContain('application/openmetrics-text');
    });

    it('should include metrics in response body', async () => {
      collector.incrementTasksTotal('queued');
      collector.recordDispatch('dev');
      const response = await exporter.createResponse();

      expect(response.body).toContain('test_tasks_total');
      expect(response.body).toContain('test_dispatch_total');
    });
  });

  describe('getCollector', () => {
    it('should return the underlying collector', () => {
      const result = exporter.getCollector();
      expect(result).toBe(collector);
    });
  });
});

describe('Global prometheus exporter functions', () => {
  beforeEach(() => {
    resetMetricsCollector();
    resetPrometheusExporter();
  });

  afterEach(() => {
    resetMetricsCollector();
    resetPrometheusExporter();
  });

  describe('initializePrometheusExporter', () => {
    it('should initialize and return the global exporter', () => {
      const collector = new MetricsCollector({ prefix: 'global_', enableDefaultMetrics: false });
      const exporter = initializePrometheusExporter({
        collector,
        endpoint: '/custom-metrics',
      });

      expect(exporter).toBeDefined();
      expect(exporter).toBeInstanceOf(PrometheusExporter);
      expect(exporter.getEndpoint()).toBe('/custom-metrics');
    });

    it('should return the same exporter after initialization', () => {
      const exporter1 = initializePrometheusExporter();
      const exporter2 = getPrometheusExporter();
      expect(exporter1).toBe(exporter2);
    });
  });

  describe('getPrometheusExporter', () => {
    it('should return a default exporter if not initialized', () => {
      const exporter = getPrometheusExporter();
      expect(exporter).toBeDefined();
      expect(exporter).toBeInstanceOf(PrometheusExporter);
    });
  });

  describe('resetPrometheusExporter', () => {
    it('should reset the global exporter', () => {
      const exporter1 = initializePrometheusExporter({ endpoint: '/before/' });
      expect(exporter1.getEndpoint()).toBe('/before/');

      resetPrometheusExporter();

      const exporter2 = getPrometheusExporter();
      expect(exporter2.getEndpoint()).toBe('/metrics');
    });
  });
});