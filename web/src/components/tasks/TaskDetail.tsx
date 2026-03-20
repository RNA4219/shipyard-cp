import { useParams, Link } from 'react-router-dom';
import { useTask, useTaskEvents, useDispatch, useCancelTask } from '../../hooks/useTasks';
import { StateBadge, RiskBadge } from '../common/StateBadge';
import { LoadingSpinner, LoadingPage } from '../common/LoadingSpinner';
import {
  ArrowLeft,
  XCircle,
  GitBranch,
  AlertCircle,
  CheckCircle2,
  XCircle as XCircleIcon,
  Activity,
} from 'lucide-react';
import { useState } from 'react';

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString();
}

function StageButton({
  stage,
  disabled,
  onClick,
}: {
  stage: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-1.5 bg-[#0e639c] hover:bg-[#1177bb] disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm font-medium text-white transition-colors"
    >
      Dispatch {stage}
    </button>
  );
}

export function TaskDetail() {
  const { taskId } = useParams<{ taskId: string }>();
  const { data: task, isLoading, error } = useTask(taskId!);
  const { data: eventsData } = useTaskEvents(taskId!);
  const dispatch = useDispatch();
  const cancelTask = useCancelTask();
  const [dispatching, setDispatching] = useState<string | null>(null);

  if (isLoading) return <LoadingPage />;
  if (error || !task) {
    return (
      <div className="p-8 text-center text-red-400">
        <AlertCircle className="h-8 w-8 mx-auto mb-2" />
        <p>Task not found</p>
        <Link to="/tasks" className="text-blue-400 hover:underline mt-2 block">
          Back to tasks
        </Link>
      </div>
    );
  }

  const events = eventsData?.items ?? [];

  const handleDispatch = async (stage: string) => {
    setDispatching(stage);
    try {
      await dispatch.mutateAsync({ taskId: task.task_id, stage });
    } finally {
      setDispatching(null);
    }
  };

  const handleCancel = async () => {
    if (confirm('Are you sure you want to cancel this task?')) {
      await cancelTask.mutateAsync(task.task_id);
    }
  };

  const canDispatchPlan = task.state === 'queued';
  const canDispatchDev = task.state === 'planned' || task.state === 'rework_required';
  const canDispatchAcceptance = task.state === 'dev_completed';
  const canCancel = !['published', 'cancelled', 'failed'].includes(task.state);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-[#3c3c3c] bg-[#252526]">
        <div className="flex items-center gap-2 mb-2">
          <Link to="/tasks" className="text-gray-400 hover:text-gray-200">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-lg font-semibold text-white truncate">{task.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <StateBadge state={task.state} />
          <RiskBadge risk={task.risk_level} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left column - Details */}
          <div className="space-y-4">
            {/* Info card */}
            <div className="bg-[#252526] rounded-lg p-4">
              <h2 className="text-sm font-semibold text-gray-400 uppercase mb-3">
                Task Info
              </h2>
              <dl className="space-y-2">
                <div className="flex justify-between">
                  <dt className="text-gray-500">ID</dt>
                  <dd className="text-gray-200 font-mono text-sm">{task.task_id}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Repository</dt>
                  <dd className="text-gray-200">
                    <a
                      href={`https://github.com/${task.repo_ref.owner}/${task.repo_ref.name}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline flex items-center gap-1"
                    >
                      <GitBranch className="h-3 w-3" />
                      {task.repo_ref.owner}/{task.repo_ref.name}
                    </a>
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Branch</dt>
                  <dd className="text-gray-200">{task.repo_ref.default_branch}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Version</dt>
                  <dd className="text-gray-200">{task.version}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Created</dt>
                  <dd className="text-gray-200">{formatDateTime(task.created_at)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Updated</dt>
                  <dd className="text-gray-200">{formatDateTime(task.updated_at)}</dd>
                </div>
              </dl>
            </div>

            {/* Objective */}
            <div className="bg-[#252526] rounded-lg p-4">
              <h2 className="text-sm font-semibold text-gray-400 uppercase mb-3">
                Objective
              </h2>
              <p className="text-gray-200 whitespace-pre-wrap">{task.objective}</p>
            </div>

            {/* Stats */}
            {(task.files_changed || task.lines_added || task.lines_deleted) && (
              <div className="bg-[#252526] rounded-lg p-4">
                <h2 className="text-sm font-semibold text-gray-400 uppercase mb-3">
                  Changes
                </h2>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-gray-200">
                      {task.files_changed ?? 0}
                    </div>
                    <div className="text-xs text-gray-500">Files Changed</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-400">
                      +{task.lines_added ?? 0}
                    </div>
                    <div className="text-xs text-gray-500">Lines Added</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-red-400">
                      -{task.lines_deleted ?? 0}
                    </div>
                    <div className="text-xs text-gray-500">Lines Deleted</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right column - Timeline & Actions */}
          <div className="space-y-4">
            {/* Actions */}
            <div className="bg-[#252526] rounded-lg p-4">
              <h2 className="text-sm font-semibold text-gray-400 uppercase mb-3">
                Actions
              </h2>
              <div className="flex flex-wrap gap-2">
                <StageButton
                  stage="plan"
                  disabled={!canDispatchPlan || dispatching === 'plan'}
                  onClick={() => handleDispatch('plan')}
                />
                <StageButton
                  stage="dev"
                  disabled={!canDispatchDev || dispatching === 'dev'}
                  onClick={() => handleDispatch('dev')}
                />
                <StageButton
                  stage="acceptance"
                  disabled={!canDispatchAcceptance || dispatching === 'acceptance'}
                  onClick={() => handleDispatch('acceptance')}
                />
                {canCancel && (
                  <button
                    onClick={handleCancel}
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded text-sm font-medium text-white transition-colors"
                  >
                    <XCircle className="h-4 w-4 inline mr-1" />
                    Cancel
                  </button>
                )}
              </div>
              {dispatching && (
                <div className="mt-2 text-sm text-gray-400 flex items-center gap-2">
                  <LoadingSpinner size="sm" />
                  Dispatching {dispatching}...
                </div>
              )}
            </div>

            {/* Timeline */}
            <div className="bg-[#252526] rounded-lg p-4">
              <h2 className="text-sm font-semibold text-gray-400 uppercase mb-3 flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Timeline
              </h2>
              {events.length === 0 ? (
                <p className="text-gray-500 text-sm">No events yet</p>
              ) : (
                <div className="space-y-2">
                  {events.map((event) => (
                    <div
                      key={event.event_id}
                      className="flex items-start gap-2 text-sm"
                    >
                      <div className="mt-1">
                        {event.to_state === 'published' ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : event.to_state === 'failed' ||
                          event.to_state === 'cancelled' ? (
                          <XCircleIcon className="h-4 w-4 text-red-500" />
                        ) : (
                          <div className="h-4 w-4 rounded-full bg-blue-500" />
                        )}
                      </div>
                      <div>
                        <div className="text-gray-200">
                          {event.from_state} → {event.to_state}
                        </div>
                        <div className="text-gray-500 text-xs">
                          {event.reason}
                        </div>
                        <div className="text-gray-600 text-xs">
                          {formatDateTime(event.occurred_at)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}