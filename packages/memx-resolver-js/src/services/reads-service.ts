/**
 * Reads service for read receipt and stale check operations
 */

import type { StoreBackend } from '../store/store-backend.js';
import type {
  AckReadRequest,
  AckReadResponse,
  StaleCheckRequest,
  StaleCheckResponse,
  StaleReason,
  ReadReceipt,
} from '../types.js';

/**
 * Reads service configuration
 */
export interface ReadsServiceConfig {
  backend: StoreBackend;
}

/**
 * Reads service for tracking document reads
 */
export class ReadsService {
  private backend: StoreBackend;

  constructor(config: ReadsServiceConfig) {
    this.backend = config.backend;
  }

  /**
   * Acknowledge reading a document
   */
  async ack(request: AckReadRequest): Promise<AckReadResponse> {
    const now = new Date().toISOString();

    const receipt: ReadReceipt = {
      task_id: request.task_id,
      doc_id: request.doc_id,
      version: request.version,
      chunk_ids: request.chunk_ids,
      reader: request.reader ?? 'agent',
      read_at: now,
    };

    await this.backend.setReadReceipt(receipt);

    return {
      status: 'acknowledged',
      task_id: request.task_id,
      doc_id: request.doc_id,
      version: request.version,
    };
  }

  /**
   * Check for stale documents
   */
  async staleCheck(request: StaleCheckRequest): Promise<StaleCheckResponse> {
    const receipts = await this.backend.getReadReceiptsByTask(request.task_id);
    const staleReasons: StaleReason[] = [];
    const now = new Date().toISOString();

    for (const receipt of receipts) {
      const doc = await this.backend.getDocument(receipt.doc_id);

      if (!doc) {
        // Document is missing
        staleReasons.push({
          task_id: request.task_id,
          doc_id: receipt.doc_id,
          previous_version: receipt.version,
          current_version: 'missing',
          reason: 'document_missing',
          detected_at: now,
        });
        continue;
      }

      if (doc.version !== receipt.version) {
        // Version mismatch
        staleReasons.push({
          task_id: request.task_id,
          doc_id: receipt.doc_id,
          previous_version: receipt.version,
          current_version: doc.version,
          reason: 'version_mismatch',
          detected_at: now,
        });
      }
    }

    // Store stale reasons
    for (const reason of staleReasons) {
      await this.backend.addStaleReason(reason);
    }

    return {
      task_id: request.task_id,
      status: staleReasons.length > 0 ? 'stale' : 'fresh',
      stale_reasons: staleReasons,
    };
  }

  /**
   * Get read receipts for a task
   */
  async getReceipts(taskId: string): Promise<ReadReceipt[]> {
    return this.backend.getReadReceiptsByTask(taskId);
  }

  /**
   * Get stale reasons for a task
   */
  async getStaleReasons(taskId: string): Promise<StaleReason[]> {
    return this.backend.getStaleReasons(taskId);
  }
}