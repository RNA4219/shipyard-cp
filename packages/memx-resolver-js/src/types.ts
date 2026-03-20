/**
 * memx-resolver-js type definitions
 * Based on cookbook-resolver interfaces specification
 */

/**
 * Importance level for documents and chunks
 */
export type Importance = 'required' | 'recommended' | 'reference';

/**
 * Document representation
 */
export interface Document {
  doc_id: string;
  doc_type: string;
  title: string;
  source_path?: string;
  version: string;
  updated_at: string;
  summary?: string;
  tags?: string[];
  feature_keys?: string[];
}

/**
 * Document chunk for granular content access
 */
export interface DocumentChunk {
  chunk_id: string;
  doc_id: string;
  heading_path?: string[];
  ordinal: number;
  body: string;
  token_estimate?: number;
  importance?: Importance;
}

/**
 * Resolve entry for document resolution results
 */
export interface ResolveEntry {
  doc_id: string;
  title: string;
  version: string;
  importance: Importance;
  reason?: string;
  top_chunks?: string[];
}

/**
 * Read receipt for tracking document reads per task
 */
export interface ReadReceipt {
  task_id: string;
  doc_id: string;
  version: string;
  chunk_ids?: string[];
  reader?: string;
  read_at: string;
}

/**
 * Stale reason for version mismatch detection
 */
export interface StaleReason {
  task_id: string;
  doc_id: string;
  previous_version: string;
  current_version: string;
  reason: 'version_mismatch' | 'document_missing';
  detected_at: string;
}

/**
 * Contract data for acceptance criteria
 */
export interface Contract {
  contract_id: string;
  type: 'api' | 'schema' | 'behavior' | 'constraint' | 'definition';
  content: string;
  acceptance_criteria?: string[];
  forbidden_patterns?: string[];
  definition_of_done?: string[];
  dependencies?: string[];
}

/**
 * Ingest request for document registration
 */
export interface IngestRequest {
  doc_type: string;
  title: string;
  source_path?: string;
  version: string;
  updated_at?: string;
  tags?: string[];
  feature_keys?: string[];
  summary?: string;
  body: string;
  chunking?: {
    mode: 'heading' | 'fixed';
    max_chars?: number;
  };
}

/**
 * Ingest response
 */
export interface IngestResponse {
  doc_id: string;
  version: string;
  chunk_count: number;
  status: 'ingested' | 'updated';
}

/**
 * Resolve request for document resolution
 */
export interface ResolveRequest {
  feature?: string;
  task_id?: string;
  topic?: string;
  limit?: number;
}

/**
 * Resolve response
 */
export interface ResolveResponse {
  required: ResolveEntry[];
  recommended: ResolveEntry[];
  reference?: ResolveEntry[];
}

/**
 * Get chunks request
 */
export interface GetChunksRequest {
  doc_id?: string;
  chunk_ids?: string[];
  query?: string;
  heading?: string;
  limit?: number;
}

/**
 * Get chunks response
 */
export interface GetChunksResponse {
  doc_id?: string;
  chunks: DocumentChunk[];
  not_found?: string[];
}

/**
 * Search request
 */
export interface SearchRequest {
  query: string;
  doc_types?: string[];
  tags?: string[];
  feature_keys?: string[];
  limit?: number;
}

/**
 * Search result item
 */
export interface SearchResult {
  doc_id: string;
  title: string;
  version: string;
  score: number;
  summary?: string;
}

/**
 * Search response
 */
export interface SearchResponse {
  results: SearchResult[];
}

/**
 * Ack read request
 */
export interface AckReadRequest {
  task_id: string;
  doc_id: string;
  version: string;
  chunk_ids?: string[];
  reader?: string;
}

/**
 * Ack read response
 */
export interface AckReadResponse {
  status: 'acknowledged';
  task_id: string;
  doc_id: string;
  version: string;
}

/**
 * Stale check request
 */
export interface StaleCheckRequest {
  task_id: string;
}

/**
 * Stale check response
 */
export interface StaleCheckResponse {
  task_id: string;
  status: 'fresh' | 'stale';
  stale_reasons: StaleReason[];
}

/**
 * Resolve contracts request
 */
export interface ResolveContractsRequest {
  feature?: string;
  task_id?: string;
}

/**
 * Resolve contracts response
 */
export interface ResolveContractsResponse {
  feature?: string;
  required_docs?: string[];
  acceptance_criteria?: string[];
  forbidden_patterns?: string[];
  definition_of_done?: string[];
}

/**
 * Error response
 */
export interface ErrorResponse {
  error_code: string;
  message: string;
  details?: Record<string, unknown>;
}