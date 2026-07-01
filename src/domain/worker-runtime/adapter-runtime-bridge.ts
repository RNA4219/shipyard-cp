import type { WorkerJob } from '../../types.js';
import type { JobPollResult, JobSubmissionResult, WorkerAdapter } from '../worker/worker-adapter.js';
import { buildWorkerRuntimePolicy } from './policy.js';
import {
  createDefaultRuntimeToolRegistry,
  InMemoryWorkerRuntimeSession,
  type RestorePointManager,
  type WorkerRuntimePolicy,
  type WorkerRuntimeSessionSnapshot,
} from './worker-runtime.js';

export interface RuntimeAdapterBridgeResult {
  session: WorkerRuntimeSessionSnapshot;
  submission: JobSubmissionResult;
}

export interface RuntimeAdapterPollResult {
  session: WorkerRuntimeSessionSnapshot;
  poll: JobPollResult;
}

/**
 * Connects Shipyard's generic WorkerRuntimeSession control plane to an existing
 * WorkerAdapter implementation. The adapter still owns concrete execution; the
 * runtime bridge owns lifecycle, policy-visible session state, and audit shape.
 */
export class WorkerRuntimeAdapterBridge {
  private readonly sessions = new Map<string, InMemoryWorkerRuntimeSession>();
  private readonly externalJobIds = new Map<string, string>();

  constructor(
    private readonly adapter: WorkerAdapter,
    private readonly policy?: WorkerRuntimePolicy,
    private readonly restorePointManager?: RestorePointManager,
  ) {}

  async start(job: WorkerJob): Promise<RuntimeAdapterBridgeResult> {
    const policy = this.policy ?? buildWorkerRuntimePolicy(job);
    const session = new InMemoryWorkerRuntimeSession(
      `runtime_${job.worker_type}_${job.job_id}`,
      policy,
      createDefaultRuntimeToolRegistry(),
      this.restorePointManager,
    );
    session.start(job);
    session.send({
      role: 'system',
      content: `Dispatching ${job.stage} job to ${this.adapter.workerType}`,
    });

    const submission = await this.adapter.submitJob(job);
    if (submission.success && submission.external_job_id) {
      this.externalJobIds.set(job.job_id, submission.external_job_id);
      session.send({
        role: 'tool',
        content: `adapter submitted external job ${submission.external_job_id}`,
      });
    } else {
      session.fail(submission.error ?? 'adapter rejected job');
    }

    this.sessions.set(job.job_id, session);
    return {
      session: session.collect(),
      submission,
    };
  }

  async poll(jobId: string): Promise<RuntimeAdapterPollResult> {
    const session = this.requireSession(jobId);
    const externalJobId = this.externalJobIds.get(jobId);
    if (!externalJobId) {
      return {
        session: session.fail('external job id is missing'),
        poll: {
          external_job_id: jobId,
          status: 'failed',
          error: 'external job id is missing',
        },
      };
    }

    const poll = await this.adapter.pollJob(externalJobId);
    if (poll.status === 'running' || poll.status === 'queued') {
      session.send({
        role: 'tool',
        content: `adapter poll status: ${poll.status}`,
      });
    } else if (poll.status === 'succeeded') {
      session.complete(poll.result?.summary ?? 'adapter job succeeded');
    } else if (poll.status === 'cancelled') {
      session.interrupt('adapter job cancelled');
    } else {
      session.fail(poll.error ?? `adapter job ended with ${poll.status}`);
    }

    return {
      session: session.collect(),
      poll,
    };
  }

  async interrupt(jobId: string, reason: string): Promise<WorkerRuntimeSessionSnapshot> {
    const session = this.requireSession(jobId);
    const externalJobId = this.externalJobIds.get(jobId);
    if (externalJobId) {
      await this.adapter.cancelJob(externalJobId);
    }
    return session.interrupt(reason);
  }

  collect(jobId: string): WorkerRuntimeSessionSnapshot | undefined {
    return this.sessions.get(jobId)?.collect();
  }

  private requireSession(jobId: string): InMemoryWorkerRuntimeSession {
    const session = this.sessions.get(jobId);
    if (!session) {
      throw new Error(`runtime session not found for job: ${jobId}`);
    }
    return session;
  }
}
