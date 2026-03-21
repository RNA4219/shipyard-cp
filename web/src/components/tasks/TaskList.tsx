import { memo, useMemo, useCallback } from 'react';
import { useTasks, usePrefetchTask, useCancelTask, getStateColor, isActiveState } from '../../hooks/useTasks';
import { StateBadge, RiskBadge } from '../common/StateBadge';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { Link } from 'react-router-dom';
import { Clock, GitBranch, AlertCircle, Search, XCircle } from 'lucide-react';
import { useTranslation } from '../../contexts/LanguageContext';
import type { Task, TaskState } from '../../types';

interface TaskListProps {
  filterState?: TaskState;
  searchQuery?: string;
}

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

interface TaskCardProps {
  task: Task;
  t: ReturnType<typeof useTranslation>;
  prefetchTask: (taskId: string) => void;
  onCancel: (taskId: string) => void;
  isCancelling: boolean;
}

// Memoized TaskCard to prevent unnecessary re-renders
const TaskCard = memo(function TaskCard({ task, t, prefetchTask, onCancel, isCancelling }: TaskCardProps) {
  const isActive = isActiveState(task.state);
  const taskId = task.task_id ?? task.id;
  const canCancel = !['published', 'cancelled', 'failed'].includes(task.state);

  const handleMouseEnter = useCallback(() => {
    prefetchTask(taskId);
  }, [prefetchTask, taskId]);

  return (
    <div className="flex items-start gap-1 p-1.5 hover:bg-[#2a2d2e] border-b border-[#3c3c3c] last:border-b-0">
      <Link
        to={`/tasks/${taskId}`}
        className="flex flex-1 items-start gap-1 min-w-0"
        onMouseEnter={handleMouseEnter}
      >
        {/* Status indicator */}
        <div className={`mt-0.5 h-1 w-1 rounded-full ${getStateColor(task.state)} ${isActive ? 'animate-pulse' : ''}`} />

        <div className="flex-1 min-w-0">
          {/* Title */}
          <div className="text-xs font-medium text-gray-200 truncate">
            {task.title ?? task.id}
          </div>

          {/* Meta info */}
          {task.repo_ref && (
            <div className="flex items-center gap-1 mt-0.5 text-[10px] text-gray-500">
              <GitBranch className="h-1.5 w-1.5" />
              <span>{task.repo_ref.owner}/{task.repo_ref.name}</span>
            </div>
          )}

          {/* Badges */}
          <div className="flex items-center gap-1 mt-1">
            <StateBadge state={task.state} />
            <RiskBadge risk={task.risk_level ?? 'medium'} />
          </div>

          {/* Time */}
          <div className="flex items-center gap-0.5 mt-1 text-[10px] text-gray-500">
            <Clock className="h-1.5 w-1.5" />
            <span>{t.updated} {formatTimeAgo(task.updated_at ?? task.updatedAt, t)}</span>
          </div>
        </div>
      </Link>
      {canCancel && (
        <button
          type="button"
          onClick={() => onCancel(taskId)}
          disabled={isCancelling}
          className="mt-0.5 p-1 rounded text-gray-500 hover:text-red-400 hover:bg-[#3c3c3c] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title={t.cancel}
        >
          {isCancelling ? <LoadingSpinner size="sm" /> : <XCircle className="h-3 w-3" />}
        </button>
      )}
    </div>
  );
});

export function TaskList({ filterState, searchQuery }: TaskListProps) {
  const { data, isLoading, error } = useTasks();
  const cancelTask = useCancelTask();
  const prefetchTask = usePrefetchTask();
  const t = useTranslation();

  // Memoized filter function
  const filterTasks = useCallback((tasks: Task[], state?: TaskState, query?: string) => {
    let result = tasks;

    // Filter by state
    if (state) {
      result = result.filter((task) => task.state === state);
    } else {
      // Hide cancelled tasks from the default view to keep the task list focused on active work.
      result = result.filter((task) => task.state !== 'cancelled');
    }

    // Filter by search query
    if (query && query.trim()) {
      const lowerQuery = query.toLowerCase().trim();
      result = result.filter((task) => {
        const title = (task.title ?? '').toLowerCase();
        const objective = (task.objective ?? '').toLowerCase();
        const taskId = (task.task_id ?? task.id ?? '').toLowerCase();
        return title.includes(lowerQuery) || objective.includes(lowerQuery) || taskId.includes(lowerQuery);
      });
    }

    return result;
  }, []);

  const filteredTasks = useMemo(() => {
    const tasks = data?.items ?? [];
    return filterTasks(tasks, filterState, searchQuery);
  }, [data?.items, filterState, searchQuery, filterTasks]);

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
        {t.noTasksFound}
      </div>
    );
  }

  if (filteredTasks.length === 0) {
    // Check if filters are active
    const hasFilters = filterState || (searchQuery && searchQuery.trim());
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
        <p className="text-xs">{t.noTasksFound}</p>
        <p className="text-[10px] mt-0.5">{t.createTaskHint}</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[#3c3c3c]">
      {filteredTasks.map((task) => (
        <TaskCard
          key={task.task_id ?? task.id}
          task={task}
          t={t}
          prefetchTask={prefetchTask}
          onCancel={(taskId) => void cancelTask.mutateAsync(taskId)}
          isCancelling={cancelTask.isPending && cancelTask.variables === (task.task_id ?? task.id)}
        />
      ))}
    </div>
  );
}
