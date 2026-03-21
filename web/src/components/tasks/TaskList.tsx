import { memo, useMemo, useCallback } from 'react';
import { useTasks, usePrefetchTask, getStateColor, isActiveState } from '../../hooks/useTasks';
import { StateBadge, RiskBadge } from '../common/StateBadge';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { Link } from 'react-router-dom';
import { Clock, GitBranch, AlertCircle, Search } from 'lucide-react';
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
}

// Memoized TaskCard to prevent unnecessary re-renders
const TaskCard = memo(function TaskCard({ task, t, prefetchTask }: TaskCardProps) {
  const isActive = isActiveState(task.state);
  const taskId = task.task_id ?? task.id;

  const handleMouseEnter = useCallback(() => {
    prefetchTask(taskId);
  }, [prefetchTask, taskId]);

  return (
    <Link
      to={`/tasks/${taskId}`}
      className="block p-3 hover:bg-[#2a2d2e] border-b border-[#3c3c3c] last:border-b-0"
      onMouseEnter={handleMouseEnter}
    >
      <div className="flex items-start gap-2">
        {/* Status indicator */}
        <div className={`mt-1 h-2 w-2 rounded-full ${getStateColor(task.state)} ${isActive ? 'animate-pulse' : ''}`} />

        <div className="flex-1 min-w-0">
          {/* Title */}
          <div className="text-sm font-medium text-gray-200 truncate">
            {task.title ?? task.id}
          </div>

          {/* Meta info */}
          {task.repo_ref && (
            <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
              <GitBranch className="h-3 w-3" />
              <span>{task.repo_ref.owner}/{task.repo_ref.name}</span>
            </div>
          )}

          {/* Badges */}
          <div className="flex items-center gap-1.5 mt-2">
            <StateBadge state={task.state} />
            <RiskBadge risk={task.risk_level ?? 'medium'} />
          </div>

          {/* Time */}
          <div className="flex items-center gap-1 mt-2 text-xs text-gray-500">
            <Clock className="h-3 w-3" />
            <span>{t.updated} {formatTimeAgo(task.updated_at ?? task.updatedAt, t)}</span>
          </div>
        </div>
      </div>
    </Link>
  );
});

export function TaskList({ filterState, searchQuery }: TaskListProps) {
  const { data, isLoading, error } = useTasks();
  const prefetchTask = usePrefetchTask();
  const t = useTranslation();

  // Memoized filter function
  const filterTasks = useCallback((tasks: Task[], state?: TaskState, query?: string) => {
    let result = tasks;

    // Filter by state
    if (state) {
      result = result.filter((task) => task.state === state);
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
      <div className="flex items-center justify-center h-32">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-32 text-red-400">
        <AlertCircle className="h-4 w-4 mr-2" />
        {t.noTasksFound}
      </div>
    );
  }

  if (filteredTasks.length === 0) {
    // Check if filters are active
    const hasFilters = filterState || (searchQuery && searchQuery.trim());
    if (hasFilters) {
      return (
        <div className="flex flex-col items-center justify-center h-32 text-gray-500">
          <Search className="h-8 w-8 mb-2 opacity-50" />
          <p>{t.noResults}</p>
          <p className="text-sm mt-1">{t.clearFilters}</p>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-32 text-gray-500">
        <p>{t.noTasksFound}</p>
        <p className="text-sm mt-1">{t.createTaskHint}</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[#3c3c3c]">
      {filteredTasks.map((task) => (
        <TaskCard key={task.task_id ?? task.id} task={task} t={t} prefetchTask={prefetchTask} />
      ))}
    </div>
  );
}