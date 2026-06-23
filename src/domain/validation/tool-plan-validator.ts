// ToolPlanValidator - validates tool_plan artifact structure

/**
 * Validation error with code, path, and message.
 */
export interface ToolPlanValidationError {
  code: 'parse_error' | 'schema_error' | 'tool_not_allowed';
  path: string;
  message: string;
}

/**
 * Result of tool_plan validation.
 */
export interface ToolPlanValidationResult {
  valid: boolean;
  errors: ToolPlanValidationError[];
}

/**
 * Allowed tools for tool_plan.
 */
const ALLOWED_TOOLS = [
  'read_file',
  'write_file',
  'apply_patch_intent',
  'run_test_suite',
  'run_command',
  'run_linter',
  'search_code',
  'list_files',
  'get_file_info',
];

/**
 * ToolPlanValidator validates tool_plan artifact structure.
 *
 * Requirements:
 * - summary: non-empty, max 400 chars
 * - calls: max 8 items, each with tool and args
 * - evidence: max 12 items, each non-empty string
 * - tool: must be in allowed_tools list
 */
export class ToolPlanValidator {
  /**
   * Validate a tool_plan object for structure and tool allowlist.
   */
  validate(plan: unknown, allowedTools?: string[]): ToolPlanValidationResult {
    const errors: ToolPlanValidationError[] = [];

    // Check if input is an object
    if (!plan || typeof plan !== 'object') {
      errors.push({
        code: 'parse_error',
        path: '',
        message: 'tool_plan must be an object',
      });
      return { valid: false, errors };
    }

    const toolPlan = plan as Record<string, unknown>;

    // Check summary
    if (!toolPlan.summary || typeof toolPlan.summary !== 'string') {
      errors.push({
        code: 'schema_error',
        path: 'summary',
        message: 'summary is required and must be a string',
      });
    } else if (toolPlan.summary.length > 400) {
      errors.push({
        code: 'schema_error',
        path: 'summary',
        message: 'summary must be at most 400 characters',
      });
    }

    // Check calls
    if (!Array.isArray(toolPlan.calls)) {
      errors.push({
        code: 'schema_error',
        path: 'calls',
        message: 'calls is required and must be an array',
      });
    } else {
      if (toolPlan.calls.length > 8) {
        errors.push({
          code: 'schema_error',
          path: 'calls',
          message: 'calls must have at most 8 items',
        });
      }

      for (let i = 0; i < toolPlan.calls.length; i++) {
        const call = toolPlan.calls[i];
        if (!call || typeof call !== 'object') {
          errors.push({
            code: 'schema_error',
            path: `calls[${i}]`,
            message: 'each call must be an object',
          });
          continue;
        }

        const callObj = call as Record<string, unknown>;

        if (!callObj.tool || typeof callObj.tool !== 'string') {
          errors.push({
            code: 'schema_error',
            path: `calls[${i}].tool`,
            message: 'tool is required and must be a string',
          });
        } else {
          // Check if tool is in allowlist
          const effectiveAllowedTools = allowedTools || ALLOWED_TOOLS;
          if (!effectiveAllowedTools.includes(callObj.tool)) {
            errors.push({
              code: 'tool_not_allowed',
              path: `calls[${i}].tool`,
              message: `tool '${callObj.tool}' is not in allowed_tools list`,
            });
          }
        }

        if (!callObj.args || typeof callObj.args !== 'object') {
          errors.push({
            code: 'schema_error',
            path: `calls[${i}].args`,
            message: 'args is required and must be an object',
          });
        }
      }
    }

    // Check evidence
    if (!Array.isArray(toolPlan.evidence)) {
      errors.push({
        code: 'schema_error',
        path: 'evidence',
        message: 'evidence is required and must be an array',
      });
    } else {
      if (toolPlan.evidence.length > 12) {
        errors.push({
          code: 'schema_error',
          path: 'evidence',
          message: 'evidence must have at most 12 items',
        });
      }

      for (let i = 0; i < toolPlan.evidence.length; i++) {
        const ev = toolPlan.evidence[i];
        if (typeof ev !== 'string' || ev.length === 0) {
          errors.push({
            code: 'schema_error',
            path: `evidence[${i}]`,
            message: 'each evidence item must be a non-empty string',
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Parse and validate a tool_plan JSON string.
   */
  parseAndValidate(json: string, allowedTools?: string[]): ToolPlanValidationResult {
    try {
      const plan = JSON.parse(json);
      return this.validate(plan, allowedTools);
    } catch (e) {
      return {
        valid: false,
        errors: [
          {
            code: 'parse_error',
            path: '',
            message: `JSON parse error: ${e instanceof Error ? e.message : 'unknown error'}`,
          },
        ],
      };
    }
  }
}

/**
 * Factory function to create ToolPlanValidator.
 */
export function createToolPlanValidator(): ToolPlanValidator {
  return new ToolPlanValidator();
}
