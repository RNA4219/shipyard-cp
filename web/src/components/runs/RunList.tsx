import { Link } from 'react-router-dom';
import { useRuns } from '../../hooks/useTasks';
import { StateBadge, RiskBadge } from '../common/StateBadge';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { Activity, Clock, AlertCircle } from 'lucide-react';
import type { Run, RunStatus } from '../../types';

const statusColors: Record<RunStatus, string> = {
  pending: 'bg-gray-500',
  running: 'bg-blue-500 animate-pulse',
  succeeded: 'bg-green-500',
  failed: 'bg-red-500',
  blocked: 'bg-amber-500',
  cancelled: 'bg-gray-500',
};

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

interface RunCardProps {
  run: Run;
}

function RunCard({ run }: RunCardProps) {
  return (
    <Link
      to={`/runs/${run.run_id}`}
      className="block p-3 hover:bg-[#2a2d2e] border-b border-[#3c3c3c] last:border-b-0"
    >
      <div className="flex items-start gap-2">
        {/* Status indicator */}
        <div className={`mt-1 h-2 w-2 rounded-full ${statusColors[run.status]}`} />

        <div className="flex-1 min-w-0">
          {/* Run ID */}
          <div className="text-sm font-medium text-gray-200 font-mono truncate">
            {run.run_id}
          </div>

          {/* Task reference */}
          <div className="text-xs text-gray-500 mt-0.5">
            Task: {run.task_id}
          </div>

          {/* Status */}
          <div className="flex items-center gap-1.5 mt-2">
            <StateBadge state={run.current_state} />
            <RiskBadge risk={run.risk_level} />
          </div>

          {/* Meta */}
          <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
            <div className="flex items-center gap-1">
              <Activity className="h-3 w-3" />
              <span>{run.status}</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>{formatTimeAgo(run.started_at)}</span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

export function RunList() {
  const { data, isLoading, error } = useRuns();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-32 text-red-400">
        <AlertCircle className="h-4 w-4 mr-2" />
        Failed to load runs
      </div>
    );
  }

  const runs = data?.items ?? [];

  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-gray-500">
        <p>No runs found</p>
        <p className="text-sm mt-1">Runs are created when tasks are dispatched</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[#3c3c3c]">
      {runs.map((run) => (
        <RunCard key={run.run_id} run={run} />
      ))}
    </div>
  );
}