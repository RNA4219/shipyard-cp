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

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-[#3c3c3c] bg-[#252526]">
        <div className="flex items-center gap-2 mb-2">
          <Link to="/runs" className="text-gray-400 hover:text-gray-200">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-lg font-semibold text-white font-mono">
            {run.run_id}
          </h1>
          <div className={`flex items-center gap-1 ${status.color}`}>
            {status.icon}
            <span className="text-sm">{run.status}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StateBadge state={run.current_state ?? 'queued'} />
          <RiskBadge risk={run.risk_level ?? 'medium'} />
          <span className="text-gray-500 text-sm">
            {t.task}: <Link to={`/tasks/${run.task_id ?? run.taskId}`} className="text-blue-400 hover:underline">{run.task_id ?? run.taskId}</Link>
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left column - Info */}
          <div className="space-y-4">
            {/* Run info */}
            <div className="bg-[#252526] rounded-lg p-4">
              <h2 className="text-sm font-semibold text-gray-400 uppercase mb-3">
                {t.runInfo}
              </h2>
              <dl className="space-y-2">
                <div className="flex justify-between">
                  <dt className="text-gray-500">{t.runId}</dt>
                  <dd className="text-gray-200 font-mono text-sm">{run.run_id}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">{t.taskId}</dt>
                  <dd className="text-gray-200 font-mono text-sm">{run.task_id}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">{t.sequence}</dt>
                  <dd className="text-gray-200">#{run.run_sequence}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">{t.currentStage}</dt>
                  <dd className="text-gray-200">{run.current_stage ?? '-'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">{t.started}</dt>
                  <dd className="text-gray-200">{formatDateTime(run.started_at ?? run.startedAt)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">{t.ended}</dt>
                  <dd className="text-gray-200">
                    {run.ended_at ? formatDateTime(run.ended_at) : '-'}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Objective */}
            {run.objective && (
              <div className="bg-[#252526] rounded-lg p-4">
                <h2 className="text-sm font-semibold text-gray-400 uppercase mb-3">
                  {t.objective}
                </h2>
                <p className="text-gray-200 whitespace-pre-wrap">{run.objective}</p>
              </div>
            )}

            {/* Blocked reason */}
            {(run.blocked_reason || run.blockedReason) && (
              <div className="bg-[#252526] rounded-lg p-4 border-l-4 border-amber-500">
                <h2 className="text-sm font-semibold text-amber-400 uppercase mb-2">
                  {t.blocked}
                </h2>
                <p className="text-gray-200">{run.blocked_reason ?? run.blockedReason}</p>
              </div>
            )}
          </div>

          {/* Right column - Timeline & Audit */}
          <div className="space-y-4">
            {/* Timeline */}
            <div className="bg-[#252526] rounded-lg p-4">
              <h2 className="text-sm font-semibold text-gray-400 uppercase mb-3 flex items-center gap-2">
                <Activity className="h-4 w-4" />
                {t.timeline}
              </h2>
              <RunTimeline runId={run.run_id ?? run.id} />
            </div>

            {/* Audit summary */}
            {auditSummary && (
              <div className="bg-[#252526] rounded-lg p-4">
                <h2 className="text-sm font-semibold text-gray-400 uppercase mb-3">
                  {t.auditSummary}
                </h2>
                <div className="text-sm">
                  <div className="text-gray-500 mb-2">
                    {t.totalEvents}: {auditSummary.total_events ?? auditSummary.totalEvents}
                  </div>
                  {(auditSummary.event_counts ?? auditSummary.eventsByType) && Object.keys(auditSummary.event_counts ?? auditSummary.eventsByType ?? {}).length > 0 && (
                    <div className="space-y-1">
                      {Object.entries(auditSummary.event_counts ?? auditSummary.eventsByType ?? {}).map(([type, count]) => (
                        <div key={type} className="flex justify-between">
                          <span className="text-gray-400">{type}</span>
                          <span className="text-gray-200">{count as number}</span>
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