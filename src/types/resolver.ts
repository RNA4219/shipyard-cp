/**
 * Resolver domain types
 */

import type { ExternalRef, LinkRole } from './common.js';

// Resolver references
export interface ResolverRefs {
  doc_refs?: string[];
  chunk_refs?: string[];
  ack_refs?: string[];
  contract_refs?: string[];
  stale_status?: 'fresh' | 'stale' | 'unknown';
  /** Document importance classification from memx-resolver */
  importance?: Record<string, 'required' | 'recommended' | 'optional'>;
  /** Reason for each document inclusion */
  reason?: Record<string, string>;
}

// Resolve docs request
export interface ResolveDocsRequest {
  feature?: string;
  topic?: string;
  task_seed?: string;
}

// Resolve docs response
export interface ResolveDocsResponse {
  typed_ref: string;
  doc_refs: string[];
  chunk_refs: string[];
  contract_refs: string[];
  stale_status: 'fresh' | 'stale' | 'unknown';
}

// Ack docs request
export interface AckDocsRequest {
  doc_id: string;
  version: string;
}

// Ack docs response
export interface AckDocsResponse {
  ack_ref: string;
}

// Stale check request
export interface StaleCheckRequest {
  doc_ids?: string[];
}

// Stale doc item
export interface StaleDocItem {
  task_id: string;
  doc_id: string;
  previous_version: string;
  current_version: string;
  reason: 'version_mismatch' | 'document_missing';
  detected_at: string;
}

// Stale check response
export interface StaleCheckResponse {
  task_id: string;
  stale: StaleDocItem[];
}

// Tracker link request
export interface TrackerLinkRequest {
  typed_ref: string;
  connection_ref?: string;
  entity_ref: string;
  link_role?: LinkRole;
  metadata_json?: string;
}

// Tracker link response
export interface TrackerLinkResponse {
  typed_ref: string;
  external_refs: ExternalRef[];
  sync_event_ref: string;
}