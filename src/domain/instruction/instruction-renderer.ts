import type { InstructionEnvelopeV2, WorkerJob } from '../../types.js';

export function renderInstructionEnvelope(envelope: InstructionEnvelopeV2): string {
  const lines: string[] = [
    `# Instruction Envelope ${envelope.protocol_version}`,
    `Job ID: ${envelope.job_id}`,
    `Task ID: ${envelope.task_id}`,
    `Stage: ${envelope.stage}`,
    '',
    '## Authority',
  ];

  for (const item of [...envelope.authority].sort((a, b) => a.tier - b.tier)) {
    lines.push(`- Tier ${item.tier} (${item.source}): ${item.instruction}`);
  }

  lines.push('', '## Objective', envelope.objective);
  appendList(lines, 'Must', envelope.must);
  appendList(lines, 'Must Not', envelope.must_not);
  appendList(
    lines,
    'Allowed Tools',
    envelope.allowed_tools.map(tool => `${tool.name}: ${JSON.stringify(tool.args_schema)}`),
  );
  lines.push(
    '',
    '## Required Output',
    `Kind: ${envelope.required_output.kind}`,
    'Return valid JSON matching this schema:',
    '```json',
    JSON.stringify(envelope.required_output.json_schema, null, 2),
    '```',
  );

  return lines.join('\n');
}

export function resolveWorkerPrompt(job: WorkerJob): string {
  if (job.instruction_envelope) {
    return renderInstructionEnvelope(job.instruction_envelope);
  }

  if (job.metadata?.instruction_envelope_version === '2.0') {
    throw new Error(`job ${job.job_id} declares InstructionEnvelopeV2 but has no instruction_envelope`);
  }

  if (job.input_prompt) {
    return job.input_prompt;
  }

  return renderFallbackPrompt(job);
}

function renderFallbackPrompt(job: WorkerJob): string {
  const lines: string[] = [
    `# Task: ${job.task_id}`,
    `## Stage: ${job.stage}`,
    '',
    '### Repository',
    `${job.repo_ref.owner}/${job.repo_ref.name} (base: ${job.repo_ref.default_branch}${job.repo_ref.base_sha ? `, SHA: ${job.repo_ref.base_sha}` : ''})`,
    '',
    '### Objective',
    job.context?.objective || '',
  ];

  appendFallbackList(lines, 'Acceptance Criteria', job.context?.acceptance_criteria ?? []);
  appendFallbackList(lines, 'Constraints', job.context?.constraints ?? []);
  appendFallbackList(lines, 'Required Outputs', job.requested_outputs ?? []);

  return lines.join('\n');
}

function appendFallbackList(lines: string[], title: string, values: string[]): void {
  if (values.length > 0) {
    lines.push('', `### ${title}`, ...values.map(value => `- ${value}`));
  }
}

function appendList(lines: string[], title: string, values: string[]): void {
  lines.push('', `## ${title}`, ...(values.length > 0 ? values.map(value => `- ${value}`) : ['- None']));
}
