import { useTasks, getStateColor, isActiveState } from '../../hooks/useTasks';
import { StateBadge, RiskBadge } from '../common/StateBadge';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { Link } from 'react-router-dom';
import { Clock, GitBranch, AlertCircle } from 'lucide-react';
import type { Task } from '../../types';

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

interface TaskCardProps {
  task: Task;
}

function TaskCard({ task }: TaskCardProps) {
  const isActive = isActiveState(task.state);

  return (
    <Link
      to={`/tasks/${task.task_id}`}
      className="block p-3 hover:bg-[#2a2d2e] border-b border-[#3c3c3c] last:border-b-0"
    >
      <div className="flex items-start gap-2">
        {/* Status indicator */}
        <div className={`mt-1 h-2 w-2 rounded-full ${getStateColor(task.state)} ${isActive ? 'animate-pulse' : ''}`} />

        <div className="flex-1 min-w-0">
          {/* Title */}
          <div className="text-sm font-medium text-gray-200 truncate">
            {task.title}
          </div>

          {/* Meta info */}
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
            <GitBranch className="h-3 w-3" />
            <span>{task.repo_ref.owner}/{task.repo_ref.name}</span>
          </div>

          {/* Badges */}
          <div className="flex items-center gap-1.5 mt-2">
            <StateBadge state={task.state} />
            <RiskBadge risk={task.risk_level} />
          </div>

          {/* Time */}
          <div className="flex items-center gap-1 mt-2 text-xs text-gray-500">
            <Clock className="h-3 w-3" />
            <span>Updated {formatTimeAgo(task.updated_at)}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export function TaskList() {
  const { data, isLoading, error } = useTasks();

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
        Failed to load tasks
      </div>
    );
  }

  const tasks = data?.items ?? [];

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-gray-500">
        <p>No tasks found</p>
        <p className="text-sm mt-1">Create a task via the API to get started</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[#3c3c3c]">
      {tasks.map((task) => (
        <TaskCard key={task.task_id} task={task} />
      ))}
    </div>
  );
}