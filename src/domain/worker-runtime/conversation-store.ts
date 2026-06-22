import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { WorkerRuntimeTurn } from './worker-runtime.js';

export interface ConversationRecord {
  session_id: string;
  job_id: string;
  turns: WorkerRuntimeTurn[];
  compacted_summary?: string;
  artifact_refs: string[];
  updated_at: string;
}

export interface CompactionResult {
  session_id: string;
  retained_turns: number;
  compacted_turns: number;
  summary: string;
}

export class InMemoryConversationStore {
  private readonly conversations = new Map<string, ConversationRecord>();

  upsert(input: {
    session_id: string;
    job_id: string;
    artifact_refs?: string[];
  }): ConversationRecord {
    const existing = this.conversations.get(input.session_id);
    if (existing) {
      const updated = {
        ...existing,
        artifact_refs: mergeUnique(existing.artifact_refs, input.artifact_refs ?? []),
        updated_at: new Date().toISOString(),
      };
      this.conversations.set(input.session_id, updated);
      return cloneRecord(updated);
    }
    const created: ConversationRecord = {
      session_id: input.session_id,
      job_id: input.job_id,
      turns: [],
      artifact_refs: input.artifact_refs ?? [],
      updated_at: new Date().toISOString(),
    };
    this.conversations.set(input.session_id, created);
    return cloneRecord(created);
  }

  appendTurn(sessionId: string, turn: WorkerRuntimeTurn): ConversationRecord {
    const record = this.requireRecord(sessionId);
    const updated: ConversationRecord = {
      ...record,
      turns: [...record.turns, turn],
      updated_at: new Date().toISOString(),
    };
    this.conversations.set(sessionId, updated);
    return cloneRecord(updated);
  }

  compact(sessionId: string, retainLastTurns: number): CompactionResult {
    if (!Number.isInteger(retainLastTurns) || retainLastTurns < 1) {
      throw new Error('retainLastTurns must be a positive integer');
    }
    const record = this.requireRecord(sessionId);
    if (record.turns.length <= retainLastTurns) {
      return {
        session_id: sessionId,
        retained_turns: record.turns.length,
        compacted_turns: 0,
        summary: record.compacted_summary ?? '',
      };
    }
    const compacted = record.turns.slice(0, -retainLastTurns);
    const retained = record.turns.slice(-retainLastTurns);
    const summary = renderCompactionSummary(record.compacted_summary, compacted);
    const updated: ConversationRecord = {
      ...record,
      turns: retained,
      compacted_summary: summary,
      updated_at: new Date().toISOString(),
    };
    this.conversations.set(sessionId, updated);
    return {
      session_id: sessionId,
      retained_turns: retained.length,
      compacted_turns: compacted.length,
      summary,
    };
  }

  get(sessionId: string): ConversationRecord | undefined {
    const record = this.conversations.get(sessionId);
    return record ? cloneRecord(record) : undefined;
  }

  save(sessionId: string, artifactRoot: string): string {
    const record = this.requireRecord(sessionId);
    const artifactPath = join(artifactRoot, record.job_id, `${sessionId}.conversation.json`);
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    return artifactPath;
  }

  load(artifactPath: string): ConversationRecord {
    const parsed = JSON.parse(readFileSync(artifactPath, 'utf8')) as ConversationRecord;
    this.conversations.set(parsed.session_id, parsed);
    return cloneRecord(parsed);
  }

  private requireRecord(sessionId: string): ConversationRecord {
    const record = this.conversations.get(sessionId);
    if (!record) {
      throw new Error(`conversation not found: ${sessionId}`);
    }
    return record;
  }
}

function renderCompactionSummary(previous: string | undefined, turns: WorkerRuntimeTurn[]): string {
  const lines = turns.map(turn => {
    const content = turn.content.replace(/\s+/g, ' ').trim().slice(0, 160);
    const toolCount = turn.tool_calls?.length ?? 0;
    return `- ${turn.role}: ${content}${toolCount > 0 ? ` (${toolCount} tool call(s))` : ''}`;
  });
  return [previous, ...lines].filter(Boolean).join('\n').slice(0, 8000);
}

function mergeUnique(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b]));
}

function cloneRecord(record: ConversationRecord): ConversationRecord {
  return JSON.parse(JSON.stringify(record)) as ConversationRecord;
}
