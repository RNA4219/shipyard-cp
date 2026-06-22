import { spawn, type ChildProcess } from 'node:child_process';

export type BackgroundProcessState = 'running' | 'exited' | 'failed' | 'stopped';

export interface BackgroundProcessSpec {
  process_id: string;
  command: string;
  args: string[];
  cwd: string;
  timeout_ms?: number;
  env?: Record<string, string>;
}

export interface BackgroundProcessSnapshot {
  process_id: string;
  command: string;
  args: string[];
  cwd: string;
  state: BackgroundProcessState;
  pid?: number;
  exit_code?: number | null;
  signal?: string | null;
  stdout_tail: string;
  stderr_tail: string;
  started_at: string;
  finished_at?: string;
  error?: string;
}

export interface ProcessHandle {
  pid?: number;
  stdout?: { on(event: 'data', listener: (data: Buffer | string) => void): void } | null;
  stderr?: { on(event: 'data', listener: (data: Buffer | string) => void): void } | null;
  on(event: 'close', listener: (code: number | null, signal: string | null) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface ProcessSpawner {
  spawn(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; windowsHide: boolean }): ProcessHandle;
}

export class NodeProcessSpawner implements ProcessSpawner {
  spawn(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; windowsHide: boolean }): ChildProcess {
    return spawn(command, args, options);
  }
}

interface ManagedProcess {
  spec: BackgroundProcessSpec;
  handle: ProcessHandle;
  snapshot: BackgroundProcessSnapshot;
  timeout?: ReturnType<typeof setTimeout>;
}

const MAX_TAIL_BYTES = 16 * 1024;

export class BackgroundProcessManager {
  private readonly processes = new Map<string, ManagedProcess>();

  constructor(private readonly spawner: ProcessSpawner = new NodeProcessSpawner()) {}

  start(spec: BackgroundProcessSpec): BackgroundProcessSnapshot {
    if (this.processes.has(spec.process_id)) {
      throw new Error(`background process already exists: ${spec.process_id}`);
    }
    const handle = this.spawner.spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      windowsHide: true,
    });
    const managed: ManagedProcess = {
      spec,
      handle,
      snapshot: {
        process_id: spec.process_id,
        command: spec.command,
        args: [...spec.args],
        cwd: spec.cwd,
        state: 'running',
        pid: handle.pid,
        stdout_tail: '',
        stderr_tail: '',
        started_at: new Date().toISOString(),
      },
    };
    handle.stdout?.on('data', data => {
      managed.snapshot.stdout_tail = appendTail(managed.snapshot.stdout_tail, data);
    });
    handle.stderr?.on('data', data => {
      managed.snapshot.stderr_tail = appendTail(managed.snapshot.stderr_tail, data);
    });
    handle.on('close', (code, signal) => {
      managed.snapshot.state = managed.snapshot.state === 'stopped' ? 'stopped' : 'exited';
      managed.snapshot.exit_code = code;
      managed.snapshot.signal = signal;
      managed.snapshot.finished_at = new Date().toISOString();
      if (managed.timeout) {
        clearTimeout(managed.timeout);
      }
    });
    handle.on('error', error => {
      managed.snapshot.state = 'failed';
      managed.snapshot.error = error.message;
      managed.snapshot.finished_at = new Date().toISOString();
      if (managed.timeout) {
        clearTimeout(managed.timeout);
      }
    });
    if (spec.timeout_ms && spec.timeout_ms > 0) {
      managed.timeout = setTimeout(() => {
        this.stop(spec.process_id, 'SIGTERM');
      }, spec.timeout_ms);
    }
    this.processes.set(spec.process_id, managed);
    return cloneSnapshot(managed.snapshot);
  }

  get(processId: string): BackgroundProcessSnapshot | undefined {
    const managed = this.processes.get(processId);
    return managed ? cloneSnapshot(managed.snapshot) : undefined;
  }

  list(): BackgroundProcessSnapshot[] {
    return Array.from(this.processes.values()).map(process => cloneSnapshot(process.snapshot));
  }

  stop(processId: string, signal: NodeJS.Signals = 'SIGTERM'): BackgroundProcessSnapshot {
    const managed = this.processes.get(processId);
    if (!managed) {
      throw new Error(`background process not found: ${processId}`);
    }
    if (managed.snapshot.state === 'running') {
      managed.snapshot.state = 'stopped';
      managed.handle.kill(signal);
    }
    if (managed.timeout) {
      clearTimeout(managed.timeout);
      managed.timeout = undefined;
    }
    return cloneSnapshot(managed.snapshot);
  }

  stopAll(signal: NodeJS.Signals = 'SIGTERM'): BackgroundProcessSnapshot[] {
    return Array.from(this.processes.keys()).map(processId => this.stop(processId, signal));
  }
}

function appendTail(previous: string, data: Buffer | string): string {
  const next = previous + (typeof data === 'string' ? data : data.toString('utf8'));
  return next.length > MAX_TAIL_BYTES ? next.slice(-MAX_TAIL_BYTES) : next;
}

function cloneSnapshot(snapshot: BackgroundProcessSnapshot): BackgroundProcessSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as BackgroundProcessSnapshot;
}
