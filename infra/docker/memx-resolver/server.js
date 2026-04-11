/**
 * memx-resolver Mock Server
 *
 * Provides mock implementations of memx-resolver API endpoints:
 * - POST /v1/docs:resolve - Resolve documents for feature/topic
 * - POST /v1/docs:versions - Get document versions
 * - POST /v1/reads:ack - Acknowledge document reads
 * - POST /v1/chunks:get - Get chunks by IDs
 * - POST /v1/contracts:resolve - Resolve contracts
 * - GET /health - Health check
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || '/app/data';

// Security: Sanitize ID to prevent prototype pollution
function sanitizeId(id) {
  if (!id || typeof id !== 'string') return null;
  // Block dangerous keys: __proto__, constructor, prototype
  if (id === '__proto__' || id === 'constructor' || id === 'prototype') return null;
  // Only allow alphanumeric, dash, underscore, colon
  if (!/^[\w:-]+$/.test(id)) return null;
  return id;
}

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Middleware
app.use(express.json());

// In-memory document store (persisted to disk)
const docStorePath = path.join(DATA_DIR, 'documents.json');
let documents = {};

function loadDocuments() {
  try {
    if (fs.existsSync(docStorePath)) {
      documents = JSON.parse(fs.readFileSync(docStorePath, 'utf8'));
    }
  } catch (e) {
    documents = {};
  }
}

function saveDocuments() {
  fs.writeFileSync(docStorePath, JSON.stringify(documents, null, 2));
}

// Initialize with default documents
function initializeDocuments() {
  loadDocuments();

  if (Object.keys(documents).length === 0) {
    // Default workflow documents
    documents = {
      'doc:workflow-cookbook:blueprint': {
        doc_id: 'doc:workflow-cookbook:blueprint',
        version: '1.0.0',
        title: 'Workflow Cookbook Blueprint',
        content: 'Standard workflow patterns for shipyard-cp tasks...',
        updated_at: new Date().toISOString(),
      },
      'doc:feature:auth': {
        doc_id: 'doc:feature:auth',
        version: '2.1.0',
        title: 'Authentication Feature Documentation',
        content: 'Authentication system design and implementation guide...',
        updated_at: new Date().toISOString(),
      },
      'doc:feature:api': {
        doc_id: 'doc:feature:api',
        version: '1.5.0',
        title: 'API Design Guidelines',
        content: 'REST API design patterns and conventions...',
        updated_at: new Date().toISOString(),
      },
      'doc:topic:testing': {
        doc_id: 'doc:topic:testing',
        version: '3.0.0',
        title: 'Testing Best Practices',
        content: 'Testing strategies and conventions...',
        updated_at: new Date().toISOString(),
      },
    };
    saveDocuments();
  }
}

initializeDocuments();

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'memx-resolver-mock' });
});

// POST /v1/docs:resolve - Resolve documents for feature/topic
app.post('/v1/docs:resolve', (req, res) => {
  const { feature, topic, task_seed } = req.body;
  const doc_refs = [];
  const chunk_refs = [];
  const contract_refs = [];

  if (feature) {
    const docId = `doc:feature:${feature}`;
    doc_refs.push(docId);

    // Create document if not exists
    if (!documents[docId]) {
      documents[docId] = {
        doc_id: docId,
        version: '1.0.0',
        title: `${feature} Feature Documentation`,
        content: `Documentation for ${feature} feature...`,
        updated_at: new Date().toISOString(),
      };
      saveDocuments();
    }

    chunk_refs.push(`chunk:feature:${feature}:1`);
    chunk_refs.push(`chunk:feature:${feature}:2`);

    // Add contract if relevant
    if (['auth', 'api', 'payment'].includes(feature)) {
      contract_refs.push(`contract:${feature}:acceptance`);
    }
  }

  if (topic) {
    const docId = `doc:topic:${topic}`;
    doc_refs.push(docId);

    if (!documents[docId]) {
      documents[docId] = {
        doc_id: docId,
        version: '1.0.0',
        title: `${topic} Topic Documentation`,
        content: `Documentation for ${topic} topic...`,
        updated_at: new Date().toISOString(),
      };
      saveDocuments();
    }
  }

  if (task_seed) {
    doc_refs.push(`doc:task:${task_seed}`);
  }

  // Default docs if nothing specified
  if (doc_refs.length === 0) {
    doc_refs.push('doc:workflow-cookbook:blueprint');
  }

  const typed_ref = `memx-resolver:resolve:${uuidv4()}`;

  res.json({
    typed_ref,
    doc_refs,
    chunk_refs,
    contract_refs,
    stale_status: 'fresh',
  });
});

// POST /v1/docs:versions - Get document versions
app.post('/v1/docs:versions', (req, res) => {
  const { doc_ids } = req.body;

  if (!doc_ids || !Array.isArray(doc_ids)) {
    return res.status(400).json({ error: 'doc_ids array required' });
  }

  const versions = doc_ids.map(docId => {
    const doc = documents[docId];
    if (doc) {
      return {
        doc_id: docId,
        version: doc.version,
        exists: true,
      };
    }
    return {
      doc_id: docId,
      version: 'unknown',
      exists: false,
    };
  });

  res.json({ versions });
});

// POST /v1/reads:ack - Acknowledge document read
app.post('/v1/reads:ack', (req, res) => {
  const { doc_id, version } = req.body;

  if (!doc_id) {
    return res.status(400).json({ error: 'doc_id required' });
  }

  const ack_ref = `ack:${Date.now()}:${doc_id}:${version || '1.0.0'}`;

  res.json({ ack_ref });
});

// POST /v1/chunks:get - Get chunks by IDs
app.post('/v1/chunks:get', (req, res) => {
  const { chunk_ids, include_metadata } = req.body;

  if (!chunk_ids || !Array.isArray(chunk_ids)) {
    return res.status(400).json({ error: 'chunk_ids array required' });
  }

  const chunks = chunk_ids.map(chunkId => {
    // Parse chunk ID: chunk:feature:auth:1
    const parts = chunkId.split(':');
    const feature = parts[2] || 'unknown';
    const num = parts[3] || '1';

    return {
      chunk_id: chunkId,
      doc_id: `doc:feature:${feature}`,
      content: `Chunk ${num} content for ${feature} feature. This is example content that would be retrieved from the actual document.`,
      metadata: include_metadata ? {
        start_line: parseInt(num) * 100,
        end_line: parseInt(num) * 100 + 50,
        importance: 'recommended',
        reason: `Relevant to ${feature} implementation`,
      } : undefined,
    };
  });

  res.json({ chunks });
});

// POST /v1/contracts:resolve - Resolve contracts
app.post('/v1/contracts:resolve', (req, res) => {
  const { contract_ids, expand_criteria } = req.body;

  if (!contract_ids || !Array.isArray(contract_ids)) {
    return res.status(400).json({ error: 'contract_ids array required' });
  }

  const contracts = contract_ids.map(contractId => {
    // Parse contract ID: contract:auth:acceptance
    const parts = contractId.split(':');
    const domain = parts[1] || 'general';
    const type = parts[2] || 'acceptance';

    return {
      contract_id: contractId,
      type: 'behavior',
      content: `Contract for ${domain} ${type}. Defines expected behavior and constraints.`,
      acceptance_criteria: expand_criteria ? [
        `All ${domain} tests must pass`,
        `${domain} module must have >80% code coverage`,
        `No security vulnerabilities in ${domain} code`,
      ] : undefined,
      forbidden_patterns: expand_criteria ? [
        'No hardcoded credentials',
        'No synchronous operations in hot paths',
      ] : undefined,
      definition_of_done: expand_criteria ? [
        `Feature ${domain} is implemented`,
        `Documentation is updated`,
        `Code review is approved`,
      ] : undefined,
    };
  });

  res.json({ contracts });
});

// GET /v1/docs/:docId - Get document content
app.get('/v1/docs/:docId', (req, res) => {
  const docId = sanitizeId(req.params.docId);
  if (!docId) {
    return res.status(400).json({ error: 'Invalid document ID' });
  }
  const doc = documents[docId];

  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }

  res.json(doc);
});

// PUT /v1/docs/:docId - Update document (for testing)
app.put('/v1/docs/:docId', (req, res) => {
  const { title, content, version } = req.body;
  const docId = sanitizeId(req.params.docId);
  if (!docId) {
    return res.status(400).json({ error: 'Invalid document ID' });
  }

  if (!documents[docId]) {
    documents[docId] = {
      doc_id: docId,
      version: '1.0.0',
      title: title || docId,
      content: content || '',
      updated_at: new Date().toISOString(),
    };
  } else {
    documents[docId] = {
      ...documents[docId],
      title: title || documents[docId].title,
      content: content || documents[docId].content,
      version: version || incrementVersion(documents[docId].version),
      updated_at: new Date().toISOString(),
    };
  }

  saveDocuments();
  res.json(documents[docId]);
});

// DELETE /v1/docs/:docId - Delete document (for testing staleness)
app.delete('/v1/docs/:docId', (req, res) => {
  const docId = sanitizeId(req.params.docId);
  if (!docId) {
    return res.status(400).json({ error: 'Invalid document ID' });
  }

  if (documents[docId]) {
    delete documents[docId];
    saveDocuments();
    res.json({ deleted: true });
  } else {
    res.status(404).json({ error: 'Document not found' });
  }
});

// Helper function to increment version
function incrementVersion(version) {
  const parts = version.split('.').map(Number);
  parts[2] = (parts[2] || 0) + 1;
  return parts.join('.');
}

// Start server
app.listen(PORT, () => {
  console.log(`memx-resolver mock server listening on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Data directory: ${DATA_DIR}`);
});