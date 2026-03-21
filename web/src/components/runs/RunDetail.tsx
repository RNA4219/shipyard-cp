import { useParams, Link } from 'react-router-dom';
import { useRun, useRunAuditSummary } from '../../hooks/useTasks';
import { RunTimeline } from './RunTimeline';
import { StateBadge, RiskBadge } from '../common/StateBadge';
import { LoadingPage } from '../common/LoadingSpinner';
import { useTranslation } from '../../contexts/LanguageContext';
import {
  ArrowLeft,
  Clock,
  AlertCircle,
  Activity,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import type { RunStatus } from '../../types';

const statusConfig: Record<RunStatus, { color: string; icon: React.ReactNode }> = {
  pending: { color: 'text-gray-400', icon: <Clock className="h-4 w-4" /> },
  running: { color: 'text-blue-400', icon: <Activity className="h-4 w-4 animate-pulse" /> },
  succeeded: { color: 'text-green-400', icon: <CheckCircle2 className="h-4 w-4" /> },
  failed: { color: 'text-red-400', icon: <XCircle className="h-4 w-4" /> },
  blocked: { color: 'text-amber-400', icon: <AlertCircle className="h-4 w-4" /> },
  cancelled: { color: 'text-gray-400', icon: <XCircle className="h-4 w-4" /> },
};

function getTranslatedStatus(status: RunStatus, t: ReturnType<typeof useTranslation>): string {
  const statusMap: Record<RunStatus, string> = {
    pending: t.statusPending,
    running: t.statusRunning,
    succeeded: t.statusSucceeded,
    failed: t.statusFailed,
    blocked: t.statusBlocked,
    cancelled: t.statusCancelled,
  };
  return statusMap[status] ?? status;
}

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString();
}

export function RunDetail() {
  const { runId } = useParams<{ runId: string }>();
  const { data: run, isLoading, error } = useRun(runId!);
  const { data: auditSummary } = useRunAuditSummary(runId!);
  const t = useTranslation();

  if (isLoading) return <LoadingPage />;
  if (error || !run) {
    return (
      <div className="p-8 text-center text-red-400">
        <AlertCircle className="h-8 w-8 mx-auto mb-2" />
        <p>{t.runNotFound}</p>
        <Link to="/runs" className="text-blue-400 hover:underline mt-2 block">
          {t.backToRuns}
        </Link>
      </div>
    );
  }

  const status = statusConfig[run.status];
  const totalEvents = auditSummary?.total_events ?? auditSummary?.totalEvents ?? 0;
  const eventCounts = auditSummary?.event_counts ?? auditSummary?.eventsByType ?? {};

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-outline-variant/20 bg-surface-container-low">
        <div className="flex items-center gap-2 mb-1">
          <Link to="/runs" className="text-on-surface-variant hover:text-on-surface">
            <ArrowLeft className="h-3 w-3" />
          </Link>
          <h1 className="text-sm font-semibold text-on-surface font-mono truncate">
            {run.run_id}
          </h1>
          <div className={`flex items-center gap-1 ${status.color}`}>
            {status.icon}
            <span className="text-xs">{getTranslatedStatus(run.status, t)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StateBadge state={run.current_state ?? 'queued'} />
          <RiskBadge risk={run.risk_level ?? 'medium'} />
          <span className="text-on-surface-variant text-xs">
            {t.task}: <Link to={`/tasks/${run.task_id ?? run.taskId}`} className="text-primary hover:underline">{run.task_id ?? run.taskId}</Link>
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left column - Info */}
          <div className="space-y-3">
            {/* Run info */}
            <div className="bg-surface-container rounded-lg p-3">
              <h2 className="text-xs font-semibold text-on-surface-variant uppercase mb-2">
                {t.runInfo}
              </h2>
              <dl className="space-y-1">
                <div className="flex justify-between text-xs">
                  <dt className="text-on-surface-variant">{t.runId}</dt>
                  <dd className="text-on-surface font-mono truncate ml-2">{run.run_id}</dd>
                </div>
                <div className="flex justify-between text-xs">
                  <dt className="text-on-surface-variant">{t.taskId}</dt>
                  <dd className="text-on-surface font-mono truncate ml-2">{run.task_id}</dd>
                </div>
                <div className="flex justify-between text-xs">
                  <dt className="text-on-surface-variant">{t.sequence}</dt>
                  <dd className="text-on-surface">#{run.run_sequence}</dd>
                </div>
                <div className="flex justify-between text-xs">
                  <dt className="text-on-surface-variant">{t.currentStage}</dt>
                  <dd className="text-on-surface">{run.current_stage ?? '-'}</dd>
                </div>
                <div className="flex justify-between text-xs">
                  <dt className="text-on-surface-variant">{t.started}</dt>
                  <dd className="text-on-surface">{formatDateTime(run.started_at ?? run.startedAt)}</dd>
                </div>
                <div className="flex justify-between text-xs">
                  <dt className="text-on-surface-variant">{t.ended}</dt>
                  <dd className="text-on-surface">
                    {run.ended_at ? formatDateTime(run.ended_at) : '-'}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Objective */}
            {run.objective && (
              <div className="bg-surface-container rounded-lg p-3">
                <h2 className="text-xs font-semibold text-on-surface-variant uppercase mb-2">
                  {t.objective}
                </h2>
                <p className="text-xs text-on-surface whitespace-pre-wrap">{run.objective}</p>
              </div>
            )}

            {/* Blocked reason */}
            {(run.blocked_reason || run.blockedReason) && (
              <div className="bg-surface-container rounded-lg p-3 border-l-2 border-error">
                <h2 className="text-xs font-semibold text-error uppercase mb-1">
                  {t.blocked}
                </h2>
                <p className="text-xs text-on-surface">{run.blocked_reason ?? run.blockedReason}</p>
              </div>
            )}
          </div>

          {/* Right column - Timeline & Audit */}
          <div className="space-y-3">
            {/* Timeline */}
            <div className="bg-surface-container rounded-lg p-3">
              <h2 className="text-xs font-semibold text-on-surface-variant uppercase mb-2 flex items-center gap-1">
                <Activity className="h-3 w-3" />
                {t.timeline}
              </h2>
              <RunTimeline runId={run.run_id ?? run.id} />
            </div>

            {/* Audit summary */}
            {auditSummary && totalEvents > 0 && (
              <div className="bg-surface-container rounded-lg p-3">
                <h2 className="text-xs font-semibold text-on-surface-variant uppercase mb-2">
                  {t.auditSummary}
                </h2>
                <div className="text-xs">
                  <div className="text-on-surface-variant mb-1">
                    {t.totalEvents}: {totalEvents}
                  </div>
                  {Object.keys(eventCounts).length > 0 && (
                    <div className="space-y-0.5">
                      {Object.entries(eventCounts).map(([type, count]) => (
                        <div key={type} className="flex justify-between">
                          <span className="text-on-surface-variant truncate">{type}</span>
                          <span className="text-on-surface ml-2">{count as number}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
