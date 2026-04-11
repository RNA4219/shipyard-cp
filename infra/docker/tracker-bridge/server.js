/**
 * tracker-bridge-materials Mock Server
 *
 * Provides mock implementations of tracker-bridge API endpoints:
 * - GET /api/v1/cache/issue/:issueId - Get cached issue
 * - GET /api/v1/cache/pr/:prId - Get cached PR
 * - GET /api/v1/cache/project-item/:itemId - Get project item
 * - GET /api/v1/cache/:entityType/:entityId/comments - Get comments
 * - GET /api/v1/cache/issue/:issueId/linked-prs - Get linked PRs
 * - POST /api/v1/entity/link - Link entity to task
 * - POST /api/v1/entity/unlink - Unlink entity
 * - GET /api/v1/connections/:connectionRef/status - Connection status
 * - GET /api/v1/connections - List connections
 * - GET /api/v1/sync-events/:syncId - Get sync event
 * - DELETE /api/v1/cache/:entityType/:entityId - Invalidate cache
 * - GET /health - Health check
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8081;
const DATA_DIR = process.env.DATA_DIR || '/app/data';

// Security: Sanitize ID to prevent prototype pollution
function sanitizeId(id) {
  if (!id || typeof id !== 'string') return null;
  // Block dangerous keys: __proto__, constructor, prototype
  if (id === '__proto__' || id === 'constructor' || id === 'prototype') return null;
  // Only allow alphanumeric, dash, underscore
  if (!/^[\w-]+$/.test(id)) return null;
  return id;
}

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Middleware
app.use(express.json());

// In-memory data stores (persisted to disk)
const dataPath = path.join(DATA_DIR, 'tracker-data.json');
let issues = {};
let prs = {};
let projectItems = {};
let syncEvents = {};
let entityLinks = {};

function loadData() {
  try {
    if (fs.existsSync(dataPath)) {
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      issues = data.issues || {};
      prs = data.prs || {};
      projectItems = data.projectItems || {};
      syncEvents = data.syncEvents || {};
      entityLinks = data.entityLinks || {};
    }
  } catch (e) {
    console.error('Failed to load data:', e);
  }
}

function saveData() {
  fs.writeFileSync(dataPath, JSON.stringify({ issues, prs, projectItems, syncEvents, entityLinks }, null, 2));
}

// Initialize with sample data
function initializeData() {
  loadData();

  if (Object.keys(issues).length === 0) {
    // Sample issues
    issues = {
      '123': {
        issue_id: '123',
        provider: 'github',
        owner: 'test-owner',
        repo: 'test-repo',
        title: 'Implement authentication flow',
        body: 'We need to implement OAuth2 authentication flow for the application.',
        state: 'open',
        labels: ['enhancement', 'auth'],
        assignees: ['developer1'],
        milestone: 'v1.0',
        created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
        cached_at: new Date().toISOString(),
      },
      '456': {
        issue_id: '456',
        provider: 'github',
        owner: 'test-owner',
        repo: 'test-repo',
        title: 'Fix API rate limiting',
        body: 'API is hitting rate limits too frequently.',
        state: 'open',
        labels: ['bug', 'api'],
        assignees: ['developer2'],
        created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
        cached_at: new Date().toISOString(),
      },
    };

    // Sample PRs
    prs = {
      '789': {
        pr_id: '789',
        provider: 'github',
        owner: 'test-owner',
        repo: 'test-repo',
        title: 'Add OAuth2 authentication',
        body: 'Implements OAuth2 authentication flow.',
        state: 'open',
        author: 'developer1',
        base_branch: 'main',
        head_branch: 'feature/oauth2',
        mergeable: true,
        draft: false,
        files_changed: 15,
        additions: 450,
        deletions: 50,
        commits: 5,
        created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
        cached_at: new Date().toISOString(),
      },
    };

    // Sample project items
    projectItems = {
      'PROJ-1': {
        item_id: 'PROJ-1',
        project_name: 'Sprint 1',
        status: 'In Progress',
        custom_fields: {
          priority: 'High',
          estimate: 5,
        },
      },
    };

    saveData();
  }
}

initializeData();

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'tracker-bridge-mock' });
});

// GET /api/v1/cache/issue/:issueId - Get cached issue
app.get('/api/v1/cache/issue/:issueId', (req, res) => {
  const issueId = sanitizeId(req.params.issueId);
  if (!issueId) {
    return res.status(400).json({ error: 'Invalid issue ID' });
  }
  const issue = issues[issueId];

  if (!issue) {
    // Generate a mock issue if not found
    const mockIssue = {
      issue_id: issueId,
      provider: 'github',
      owner: 'test-owner',
      repo: 'test-repo',
      title: `Issue #${issueId}`,
      body: `This is a mock issue #${issueId} for testing purposes.`,
      state: 'open',
      labels: ['test'],
      assignees: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      cached_at: new Date().toISOString(),
    };
    issues[issueId] = mockIssue;
    saveData();
    return res.json(mockIssue);
  }

  res.json(issue);
});

// GET /api/v1/cache/pr/:prId - Get cached PR
app.get('/api/v1/cache/pr/:prId', (req, res) => {
  const prId = sanitizeId(req.params.prId);
  if (!prId) {
    return res.status(400).json({ error: 'Invalid PR ID' });
  }
  const pr = prs[prId];

  if (!pr) {
    // Generate a mock PR if not found
    const mockPR = {
      pr_id: prId,
      provider: 'github',
      owner: 'test-owner',
      repo: 'test-repo',
      title: `PR #${prId}`,
      body: `This is a mock PR #${prId} for testing purposes.`,
      state: 'open',
      author: 'test-user',
      base_branch: 'main',
      head_branch: `feature/pr-${prId}`,
      mergeable: true,
      draft: false,
      files_changed: 5,
      additions: 100,
      deletions: 20,
      commits: 2,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      cached_at: new Date().toISOString(),
    };
    prs[prId] = mockPR;
    saveData();
    return res.json(mockPR);
  }

  res.json(pr);
});

// GET /api/v1/cache/project-item/:itemId - Get project item
app.get('/api/v1/cache/project-item/:itemId', (req, res) => {
  const itemId = sanitizeId(req.params.itemId);
  if (!itemId) {
    return res.status(400).json({ error: 'Invalid item ID' });
  }
  const item = projectItems[itemId];

  if (!item) {
    // Generate a mock project item if not found
    const mockItem = {
      item_id: itemId,
      project_name: 'Test Project',
      status: 'Todo',
      custom_fields: {},
    };
    projectItems[itemId] = mockItem;
    saveData();
    return res.json(mockItem);
  }

  res.json(item);
});

// GET /api/v1/cache/:entityType/:entityId/comments - Get comments
app.get('/api/v1/cache/:entityType/:entityId/comments', (req, res) => {
  const entityType = sanitizeId(req.params.entityType);
  const entityId = sanitizeId(req.params.entityId);
  if (!entityType || !entityId) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }

  // Generate mock comments
  const comments = [
    {
      comment_id: '1',
      author: 'reviewer1',
      body: 'Looks good to me! Just one minor suggestion.',
      created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      reaction_summary: { thumbs_up: 2 },
    },
    {
      comment_id: '2',
      author: 'developer1',
      body: 'Thanks for the review! I\'ll address the feedback.',
      created_at: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    },
  ];

  res.json({ comments });
});

// GET /api/v1/cache/issue/:issueId/linked-prs - Get linked PRs
app.get('/api/v1/cache/issue/:issueId/linked-prs', (req, res) => {
  const issueId = sanitizeId(req.params.issueId);
  if (!issueId) {
    return res.status(400).json({ error: 'Invalid issue ID' });
  }

  // Return PRs that mention this issue
  const linkedPRs = Object.values(prs).filter(pr =>
    pr.body && pr.body.includes(`#${issueId}`)
  );

  res.json({ prs: linkedPRs });
});

// POST /api/v1/entity/link - Link entity to task
app.post('/api/v1/entity/link', (req, res) => {
  const { typed_ref, entity_ref, connection_ref, link_role, metadata } = req.body;

  const linkId = uuidv4();
  const syncId = uuidv4();

  entityLinks[linkId] = {
    typed_ref,
    entity_ref,
    connection_ref: connection_ref || 'github-main',
    link_role: link_role || 'primary',
    metadata,
    linked_at: new Date().toISOString(),
  };

  syncEvents[syncId] = {
    sync_id: syncId,
    source: connection_ref || 'github-main',
    entity_type: 'entity_link',
    entity_id: entity_ref,
    operation: 'link',
    occurred_at: new Date().toISOString(),
    fingerprint: uuidv4(),
    direction: 'outbound',
    status: 'applied',
  };

  saveData();

  res.json({
    success: true,
    sync_event_ref: `sync:${syncId}`,
    external_refs: [
      { kind: 'entity_link', value: entity_ref, connection_ref },
    ],
    linked_at: new Date().toISOString(),
  });
});

// POST /api/v1/entity/unlink - Unlink entity
app.post('/api/v1/entity/unlink', (req, res) => {
  const { typed_ref, entity_ref } = req.body;

  // Find and remove matching links
  for (const [linkId, link] of Object.entries(entityLinks)) {
    if (link.typed_ref === typed_ref && link.entity_ref === entity_ref) {
      delete entityLinks[linkId];
    }
  }

  const syncId = uuidv4();
  syncEvents[syncId] = {
    sync_id: syncId,
    source: 'github-main',
    entity_type: 'entity_link',
    entity_id: entity_ref,
    operation: 'unlink',
    occurred_at: new Date().toISOString(),
    status: 'applied',
  };

  saveData();

  res.json({ success: true, sync_event_ref: `sync:${syncId}` });
});

// GET /api/v1/connections/:connectionRef/status - Connection status
app.get('/api/v1/connections/:connectionRef/status', (req, res) => {
  const { connectionRef } = req.params;

  res.json({
    connection_ref: connectionRef,
    provider: 'github',
    status: 'active',
    last_sync: new Date().toISOString(),
    rate_limit_remaining: 4500,
  });
});

// GET /api/v1/connections - List connections
app.get('/api/v1/connections', (req, res) => {
  res.json({
    connections: [
      {
        connection_ref: 'github-main',
        provider: 'github',
        status: 'active',
        last_sync: new Date().toISOString(),
      },
    ],
  });
});

// GET /api/v1/sync-events/:syncId - Get sync event
app.get('/api/v1/sync-events/:syncId', (req, res) => {
  const { syncId } = req.params;
  const syncEvent = syncEvents[syncId];

  if (!syncEvent) {
    return res.status(404).json({ error: 'Sync event not found' });
  }

  res.json(syncEvent);
});

// GET /api/v1/sync-events/:entityType/:entityId - Get sync events for entity
app.get('/api/v1/sync-events/:entityType/:entityId', (req, res) => {
  const entityType = sanitizeId(req.params.entityType);
  const entityId = sanitizeId(req.params.entityId);
  if (!entityType || !entityId) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }
  const { limit, since } = req.query;

  const events = Object.values(syncEvents)
    .filter(e => e.entity_type === entityType && e.entity_id === entityId)
    .slice(0, parseInt(limit) || 10);

  res.json({ events });
});

// DELETE /api/v1/cache/:entityType/:entityId - Invalidate cache
app.delete('/api/v1/cache/:entityType/:entityId', (req, res) => {
  const entityType = sanitizeId(req.params.entityType);
  const entityId = sanitizeId(req.params.entityId);
  if (!entityType || !entityId) {
    return res.status(400).json({ error: 'Invalid parameters' });
  }

  switch (entityType) {
    case 'issue':
      delete issues[entityId];
      break;
    case 'pr':
      delete prs[entityId];
      break;
    case 'project-item':
      delete projectItems[entityId];
      break;
  }

  saveData();
  res.json({ invalidated: true });
});

// POST /api/v1/issues - Create issue (for testing)
app.post('/api/v1/issues', (req, res) => {
  const { title, body, labels, owner, repo } = req.body;
  const issueId = String(Object.keys(issues).length + 100);

  const issue = {
    issue_id: issueId,
    provider: 'github',
    owner: owner || 'test-owner',
    repo: repo || 'test-repo',
    title: title || `Issue #${issueId}`,
    body: body || '',
    state: 'open',
    labels: labels || [],
    assignees: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    cached_at: new Date().toISOString(),
  };

  issues[issueId] = issue;
  saveData();

  res.status(201).json(issue);
});

// PUT /api/v1/issues/:issueId - Update issue (for testing)
app.put('/api/v1/issues/:issueId', (req, res) => {
  const issueId = sanitizeId(req.params.issueId);
  if (!issueId) {
    return res.status(400).json({ error: 'Invalid issue ID' });
  }
  const updates = req.body;

  if (!issues[issueId]) {
    return res.status(404).json({ error: 'Issue not found' });
  }

  issues[issueId] = {
    ...issues[issueId],
    ...updates,
    updated_at: new Date().toISOString(),
    cached_at: new Date().toISOString(),
  };

  saveData();
  res.json(issues[issueId]);
});

// Start server
app.listen(PORT, () => {
  console.log(`tracker-bridge mock server listening on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Data directory: ${DATA_DIR}`);
});