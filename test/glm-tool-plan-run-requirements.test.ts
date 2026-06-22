import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function readDoc(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

describe('GLM tool_plan Run requirements', () => {
  it('documents all requested safety requirements', () => {
    const doc = readDoc('docs/project/GLM_TOOL_PLAN_RUN_REQUIREMENTS.md');

    for (const phrase of [
      'dry-run mode',
      'diff artifact生成',
      '最大変更ファイル数',
      '最大書き込みサイズ',
      'allowed path prefix',
      'test failure summarizer',
      'rework loop',
      'artifact URIの実体保存',
      'apply_patch_intent曖昧一致禁止',
      'execution verdict',
      'shipyard自身のacceptance gate',
    ]) {
      expect(doc).toContain(phrase);
    }
  });

  it('connects the requirements to the four OSS boundaries', () => {
    const doc = readDoc('docs/project/GLM_TOOL_PLAN_RUN_REQUIREMENTS.md');

    for (const repo of [
      'agent-protocols',
      'agent-taskstate',
      'agent-gatefield',
      'agent-state-gate',
    ]) {
      expect(doc).toContain(repo);
    }

    expect(doc).toContain('RunSystemPacket');
    expect(doc).toContain('Evidence');
    expect(doc).toContain('DecisionPacket');
  });

  it('is linked from Run-system and instruction precision documents', () => {
    const runSystem = readDoc('docs/project/RUN_SYSTEM_INTEGRATION.md');
    const instructionSpec = readDoc('docs/project/INSTRUCTION_PRECISION_SPECIFICATION.md');
    const requirements = readDoc('docs/project/REQUIREMENTS.md');

    expect(runSystem).toContain('GLM_TOOL_PLAN_RUN_REQUIREMENTS.md');
    expect(instructionSpec).toContain('GLM_TOOL_PLAN_RUN_REQUIREMENTS.md');
    expect(requirements).toContain('GLM_TOOL_PLAN_RUN_REQUIREMENTS.md');
  });
});
