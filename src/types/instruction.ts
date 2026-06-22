// InstructionEnvelopeV2 types for low-parameter model protocol

/**
 * Authority source types for instruction hierarchy.
 * Higher tier (lower number) takes precedence over lower tier.
 */
export type AuthoritySource =
  | 'system'
  | 'policy'
  | 'task'
  | 'developer'
  | 'user'
  | 'tool'
  | 'retrieved_doc';

/**
 * Authority instruction with tier-based priority.
 * tier 1-9, lower number = higher authority.
 */
export interface AuthorityInstruction {
  tier: number;
  source: AuthoritySource;
  instruction: string;
}

/**
 * Output kind required from the worker.
 * Stage-specific constraints apply:
 * - plan: plan_intent only (no write tools)
 * - dev: tool_plan or edit_intent
 * - acceptance: acceptance_verdict
 */
export type RequiredOutputKind =
  | 'plan_intent'
  | 'tool_plan'
  | 'edit_intent'
  | 'test_plan'
  | 'acceptance_verdict';

/**
 * Allowed tool definition with args schema.
 */
export interface AllowedTool {
  name: string;
  args_schema: Record<string, unknown>;
}

/**
 * Required output contract with kind and JSON schema.
 */
export interface RequiredOutputContract {
  kind: RequiredOutputKind;
  json_schema: Record<string, unknown>;
}

/**
 * InstructionEnvelopeV2 - machine-verifiable instruction contract
 * for low-parameter model execution.
 *
 * This replaces free-form input_prompt with structured, validated
 * instructions that reduce semantic drift.
 *
 * Key design:
 * - authority tier hierarchy prevents instruction injection
 * - allowed_tools whitelist prevents unauthorized tool use
 * - required_output constrains output format per stage
 * - must/must_not provide explicit behavioral constraints
 */
export interface InstructionEnvelopeV2 {
  protocol_version: '2.0';
  job_id: string;
  task_id: string;
  typed_ref: string;
  stage: 'plan' | 'dev' | 'acceptance';
  authority: AuthorityInstruction[];
  objective: string;
  must: string[];
  must_not: string[];
  allowed_tools: AllowedTool[];
  required_output: RequiredOutputContract;
}

/**
 * Tool plan output structure for dev stage.
 * Low-parameter models should output tool_plan instead of large patches.
 */
export interface ToolPlanOutput {
  summary: string;
  /**
   * When true, the executor must not write to the workspace and must only
   * report planned operations.
   */
  dry_run?: boolean;
  /**
   * Repo-relative path prefixes the plan is allowed to modify. Read-only tools
   * may inspect other repo-relative paths, but write_file and apply_patch_intent
   * are constrained by this list when present.
   */
  allowed_paths?: string[];
  /**
   * Optional execution limits. Defaults are intentionally conservative in the
   * local executor.
   */
  limits?: {
    max_files?: number;
    max_write_bytes_per_file?: number;
  };
  calls: Array<{
    tool: string;
    args: Record<string, unknown>;
  }>;
  evidence: string[];
}

/**
 * Edit intent output structure for dev stage.
 * Alternative to tool_plan for simpler edit operations.
 */
export interface EditIntentOutput {
  path: string;
  locator: string;
  replacement: string;
  reason?: string;
}

/**
 * Acceptance verdict output structure.
 */
export interface AcceptanceVerdictOutput {
  outcome: 'accept' | 'reject' | 'rework' | 'needs_manual_review';
  reason: string;
  evidence_refs?: string[];
  checklist_completed?: boolean;
}
