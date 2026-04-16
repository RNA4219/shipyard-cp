/**
 * JSON Schema Validation Definitions for Fastify Routes
 *
 * These schemas provide request validation and automatic response serialization.
 */

// Task State enum values
const TASK_STATES = [
  'queued', 'planning', 'planned', 'developing', 'dev_completed',
  'accepting', 'accepted', 'rework_required', 'integrating', 'integrated',
  'publish_pending_approval', 'publishing', 'published', 'cancelled', 'failed', 'blocked'
] as const;

// Risk Level enum values
const RISK_LEVELS = ['low', 'medium', 'high'] as const;

// Worker stages
const WORKER_STAGES = ['plan', 'dev', 'acceptance'] as const;

// Worker types
const WORKER_TYPES = ['codex', 'claude_code', 'google_antigravity'] as const;

/**
 * Create Task Request Schema
 */
export const createTaskSchema = {
  body: {
    type: 'object',
    required: ['title', 'objective', 'typed_ref', 'repo_ref'],
    additionalProperties: true,
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 500 },
      objective: { type: 'string', minLength: 1, maxLength: 5000 },
      typed_ref: {
        type: 'string',
        pattern: '^[a-z0-9_-]+:[a-z0-9_-]+:[a-z0-9_-]+:.+$',
        minLength: 1,
        maxLength: 500
      },
      description: { type: 'string', maxLength: 10000 },
      repo_ref: {
        type: 'object',
        required: ['provider', 'owner', 'name', 'default_branch'],
        additionalProperties: false,
        properties: {
          provider: { type: 'string', enum: ['github'] },
          owner: { type: 'string', minLength: 1, maxLength: 100 },
          name: { type: 'string', minLength: 1, maxLength: 100 },
          default_branch: { type: 'string', minLength: 1, maxLength: 100 },
          base_sha: { type: 'string', pattern: '^[a-fA-F0-9]{7,64}$' }
        }
      },
      risk_level: { type: 'string', enum: RISK_LEVELS },
      labels: {
        type: 'array',
        items: { type: 'string', maxLength: 100 },
        maxItems: 20
      }
    }
  },
  response: {
    201: {
      type: 'object',
      required: ['task_id', 'title', 'objective', 'typed_ref', 'state', 'repo_ref', 'created_at'],
      additionalProperties: true,
      properties: {
        task_id: { type: 'string' },
        title: { type: 'string' },
        objective: { type: 'string' },
        typed_ref: { type: 'string' },
        state: { type: 'string', enum: TASK_STATES },
        repo_ref: { type: 'object' },
        created_at: { type: 'string', format: 'date-time' }
      }
    }
  }
};

/**
 * Dispatch Request Schema
 */
export const dispatchSchema = {
  body: {
    type: 'object',
    required: ['target_stage'],
    additionalProperties: false,
    properties: {
      target_stage: { type: 'string', enum: WORKER_STAGES },
      worker_selection: { type: 'string', enum: WORKER_TYPES },
      skip_permissions: { type: 'boolean' },
      debug_mode: { type: 'boolean' }
    }
  },
  response: {
    202: {
      type: 'object',
      required: ['job_id', 'task_id', 'stage', 'worker_type', 'status'],
      additionalProperties: true,
      properties: {
        job_id: { type: 'string' },
        task_id: { type: 'string' },
        stage: { type: 'string', enum: WORKER_STAGES },
        worker_type: { type: 'string', enum: WORKER_TYPES },
        status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed'] }
      }
    }
  }
};

/**
 * Worker Result Schema
 */
export const workerResultSchema = {
  body: {
    type: 'object',
    required: ['job_id', 'status'],
    additionalProperties: true,
    properties: {
      job_id: { type: 'string', minLength: 1 },
      status: { type: 'string', enum: ['completed', 'failed', 'escalated'] },
      verdict: {
        type: 'object',
        required: ['outcome'],
        additionalProperties: false,
        properties: {
          outcome: { type: 'string', enum: ['accept', 'reject', 'rework', 'needs_manual_review'] },
          reason: { type: 'string', maxLength: 5000 },
          manual_notes: { type: 'string', maxLength: 5000 }
        }
      },
      patches: {
        type: 'array',
        items: {
          type: 'object',
          required: ['path', 'content'],
          properties: {
            path: { type: 'string' },
            content: { type: 'string' }
          }
        }
      },
      test_results: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'passed'],
          properties: {
            name: { type: 'string' },
            passed: { type: 'boolean' },
            duration_ms: { type: 'number' },
            error_message: { type: 'string' }
          }
        }
      },
      artifacts: {
        type: 'array',
        items: {
          type: 'object',
          required: ['artifact_id', 'kind'],
          properties: {
            artifact_id: { type: 'string' },
            kind: { type: 'string', enum: ['log', 'report', 'screenshot', 'trace', 'json', 'other'] }
          }
        }
      },
      escalation: {
        type: 'object',
        required: ['reason'],
        properties: {
          reason: { type: 'string' },
          suggested_action: { type: 'string' }
        }
      },
      error_message: { type: 'string', maxLength: 10000 }
    }
  }
};

/**
 * Publish Request Schema
 */
export const publishSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      mode: { type: 'string', enum: ['no_op', 'dry_run', 'apply'] },
      targets: {
        type: 'array',
        items: { type: 'string', enum: ['deployment', 'release', 'package_publish', 'external_api'] },
        maxItems: 10
      },
      idempotency_key: { type: 'string', maxLength: 100 },
      rollback_notes: { type: 'string', maxLength: 5000 }
    }
  }
};

/**
 * Integrate Request Schema
 */
export const integrateSchema = {
  body: {
    type: 'object',
    required: ['base_sha'],
    additionalProperties: false,
    properties: {
      base_sha: { type: 'string', pattern: '^[a-fA-F0-9]{7,64}$' }
    }
  }
};

/**
 * Resolve Docs Request Schema
 */
export const resolveDocsSchema = {
  body: {
    type: 'object',
    required: ['doc_refs'],
    additionalProperties: false,
    properties: {
      doc_refs: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        minItems: 1,
        maxItems: 50
      },
      chunk_size: { type: 'integer', minimum: 100, maximum: 10000 },
      context_bundle_id: { type: 'string' }
    }
  }
};

/**
 * Ack Docs Request Schema
 */
export const ackDocsSchema = {
  body: {
    type: 'object',
    required: ['doc_refs'],
    additionalProperties: false,
    properties: {
      doc_refs: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        minItems: 1,
        maxItems: 50
      }
    }
  }
};

/**
 * Stale Check Request Schema
 */
export const staleCheckSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      doc_refs: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        maxItems: 50
      },
      check_all: { type: 'boolean' }
    }
  }
};

/**
 * Tracker Link Request Schema
 */
export const trackerLinkSchema = {
  body: {
    type: 'object',
    required: ['tracker_type', 'tracker_ref'],
    additionalProperties: false,
    properties: {
      tracker_type: { type: 'string', enum: ['github_issue', 'github_project', 'linear', 'jira'] },
      tracker_ref: { type: 'string', minLength: 1, maxLength: 500 },
      role: { type: 'string', enum: ['primary', 'secondary', 'blocked_by', 'blocks'] }
    }
  }
};

/**
 * State Transition Event Schema
 */
export const stateTransitionSchema = {
  body: {
    type: 'object',
    required: ['from_state', 'to_state', 'trigger'],
    additionalProperties: false,
    properties: {
      from_state: { type: 'string', enum: TASK_STATES },
      to_state: { type: 'string', enum: TASK_STATES },
      trigger: { type: 'string', minLength: 1, maxLength: 100 },
      reason: { type: 'string', maxLength: 500 },
      job_id: { type: 'string' }
    }
  }
};

/**
 * Approve Publish Request Schema
 */
export const approvePublishSchema = {
  body: {
    type: 'object',
    required: ['approval_token'],
    additionalProperties: false,
    properties: {
      approval_token: { type: 'string', minLength: 1, maxLength: 200 }
    }
  }
};

/**
 * Complete Acceptance Request Schema
 */
export const completeAcceptanceSchema = {
  body: {
    type: 'object',
    required: ['outcome'],
    additionalProperties: false,
    properties: {
      outcome: { type: 'string', enum: ['accept', 'reject', 'rework'] },
      reason: { type: 'string', maxLength: 5000 },
      manual_notes: { type: 'string', maxLength: 5000 }
    }
  }
};

/**
 * Complete Integrate Request Schema
 */
export const completeIntegrateSchema = {
  body: {
    type: 'object',
    required: ['success'],
    additionalProperties: false,
    properties: {
      success: { type: 'boolean' },
      checks_passed: { type: 'boolean' },
      merge_commit_sha: { type: 'string', pattern: '^[a-fA-F0-9]{7,64}$' },
      error_message: { type: 'string', maxLength: 5000 }
    }
  }
};

/**
 * Complete Publish Request Schema
 */
export const completePublishSchema = {
  body: {
    type: 'object',
    required: ['success'],
    additionalProperties: false,
    properties: {
      success: { type: 'boolean' },
      external_refs: {
        type: 'array',
        items: {
          type: 'object',
          required: ['kind', 'value'],
          properties: {
            kind: { type: 'string', enum: ['github_issue', 'github_project_item', 'release', 'deployment', 'tag'] },
            value: { type: 'string' }
          }
        }
      },
      rollback_notes: { type: 'string', maxLength: 5000 },
      error_message: { type: 'string', maxLength: 5000 }
    }
  }
};

/**
 * Job Heartbeat Request Schema
 */
export const jobHeartbeatSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string', enum: ['running', 'paused', 'escalated', 'waiting'] },
      progress_percent: { type: 'integer', minimum: 0, maximum: 100 },
      message: { type: 'string', maxLength: 1000 }
    }
  }
};

/**
 * Repo Policy Schema
 */
export const repoPolicySchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      allow_skip_permissions: { type: 'boolean' },
      default_risk_level: { type: 'string', enum: RISK_LEVELS },
      require_acceptance: { type: 'boolean' },
      require_integration: { type: 'boolean' },
      integration_branch_prefix: { type: 'string', maxLength: 50 },
      publish_approval_required: { type: 'boolean' },
      allowed_publish_targets: {
        type: 'array',
        items: { type: 'string' }
      },
      max_concurrent_jobs: { type: 'integer', minimum: 1, maximum: 10 }
    }
  }
};

/**
 * Chunks Get Request Schema
 */
export const chunksGetSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      chunk_ids: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        maxItems: 100
      },
      doc_id: { type: 'string', minLength: 1 }
    }
  }
};

/**
 * Contracts Resolve Request Schema
 */
export const contractsResolveSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      feature: { type: 'string', maxLength: 100 },
      task_id: { type: 'string', minLength: 1 }
    }
  }
};