import { memo, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useRuns, usePrefetchRun } from '../../hooks/useTasks';
import { StateBadge, RiskBadge } from '../common/StateBadge';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { Activity, Clock, AlertCircle, Search } from 'lucide-react';
import { useTranslation } from '../../contexts/LanguageContext';
import type { Run, RunStatus } from '../../types';

interface RunListProps {
  filterStatus?: RunStatus;
  searchQuery?: string;
}

const statusColors: Record<RunStatus, string> = {
  pending: 'bg-gray-500',
  running: 'bg-blue-500 animate-pulse',
  succeeded: 'bg-green-500',
  failed: 'bg-red-500',
  blocked: 'bg-amber-500',
  cancelled: 'bg-gray-500',
};

function formatTimeAgo(dateString: string, t: ReturnType<typeof useTranslation>): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return t.justNow;
  if (diffMins < 60) return `${diffMins}${t.minAgo}`;
  if (diffHours < 24) return `${diffHours}${t.hrAgo}`;
  return `${diffDays}${t.dayAgo}`;
}

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

interface RunCardProps {
  run: Run;
  t: ReturnType<typeof useTranslation>;
  prefetchRun: (runId: string) => void;
}

// Memoized RunCard to prevent unnecessary re-renders
const RunCard = memo(function RunCard({ run, t, prefetchRun }: RunCardProps) {
  const runId = run.run_id ?? run.id;

  const handleMouseEnter = useCallback(() => {
    prefetchRun(runId);
  }, [prefetchRun, runId]);

  return (
    <Link
      to={`/runs/${runId}`}
      className="block p-1.5 hover:bg-[#2a2d2e] border-b border-[#3c3c3c] last:border-b-0"
      onMouseEnter={handleMouseEnter}
    >
      <div className="flex items-start gap-1">
        {/* Status indicator */}
        <div className={`mt-0.5 h-1 w-1 rounded-full ${statusColors[run.status]}`} />

        <div className="flex-1 min-w-0">
          {/* Run ID */}
          <div className="text-xs font-medium text-gray-200 font-mono truncate">
            {runId}
          </div>

          {/* Task reference */}
          <div className="text-[10px] text-gray-500 mt-0.5">
            {t.task}: {run.task_id ?? run.taskId}
          </div>

          {/* Status */}
          <div className="flex items-center gap-1 mt-1">
            <StateBadge state={run.current_state ?? 'queued'} />
            <RiskBadge risk={run.risk_level ?? 'medium'} />
          </div>

          {/* Meta */}
          <div className="flex items-center gap-1.5 mt-1 text-[10px] text-gray-500">
            <div className="flex items-center gap-0.5">
              <Activity className="h-1.5 w-1.5" />
              <span>{getTranslatedStatus(run.status, t)}</span>
            </div>
            <div className="flex items-center gap-0.5">
              <Clock className="h-1.5 w-1.5" />
              <span>{formatTimeAgo(run.started_at ?? run.startedAt, t)}</span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
});

export function RunList({ filterStatus, searchQuery }: RunListProps) {
  const { data, isLoading, error } = useRuns();
  const prefetchRun = usePrefetchRun();
  const t = useTranslation();

  // Memoized filter function
  const filterRuns = useCallback((runs: Run[], status?: RunStatus, query?: string) => {
    let result = runs;

    // Filter by status
    if (status) {
      result = result.filter((run) => run.status === status);
    }

    // Filter by search query
    if (query && query.trim()) {
      const lowerQuery = query.toLowerCase().trim();
      result = result.filter((run) => {
        const runId = (run.run_id ?? run.id ?? '').toLowerCase();
        const taskId = (run.task_id ?? run.taskId ?? '').toLowerCase();
        const objective = (run.objective ?? '').toLowerCase();
        return runId.includes(lowerQuery) || taskId.includes(lowerQuery) || objective.includes(lowerQuery);
      });
    }

    return result;
  }, []);

  const filteredRuns = useMemo(() => {
    const runs = data?.items ?? data?.runs ?? [];
    return filterRuns(runs, filterStatus, searchQuery);
  }, [data?.items, data?.runs, filterStatus, searchQuery, filterRuns]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-16">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-16 text-red-400">
        <AlertCircle className="h-2 w-2 mr-1" />
        {t.noRunsFound}
      </div>
    );
  }

  if (filteredRuns.length === 0) {
    // Check if filters are active
    const hasFilters = filterStatus || (searchQuery && searchQuery.trim());
    if (hasFilters) {
      return (
        <div className="flex flex-col items-center justify-center h-16 text-gray-500">
          <Search className="h-4 w-4 mb-1 opacity-50" />
          <p className="text-xs">{t.noResults}</p>
          <p className="text-[10px] mt-0.5">{t.clearFilters}</p>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-16 text-gray-500">
        <p className="text-xs">{t.noRunsFound}</p>
        <p className="text-[10px] mt-0.5">{t.runsHint}</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[#3c3c3c]">
      {filteredRuns.map((run) => (
        <RunCard key={run.run_id ?? run.id} run={run} t={t} prefetchRun={prefetchRun} />
      ))}
    </div>
  );
}