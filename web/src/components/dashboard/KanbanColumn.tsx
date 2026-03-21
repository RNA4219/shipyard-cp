import { memo } from 'react';
import type { Task } from '../../types';
import { StateBadge } from '../common/StateBadge';

interface KanbanColumnProps {
  title: string;
  tasks: Task[];
  color: 'primary' | 'secondary' | 'tertiary' | 'outline';
  count?: number;
}

const colorConfig = {
  primary: {
    dot: 'bg-primary',
    dotAnimate: 'animate-pulse',
    badge: 'bg-primary/20 text-primary',
    column: 'bg-primary/5',
    border: 'border-primary/20',
  },
  secondary: {
    dot: 'bg-secondary',
    dotAnimate: '',
    badge: 'bg-secondary/20 text-secondary',
    column: 'bg-secondary/5',
    border: 'border-secondary/20',
  },
  tertiary: {
    dot: 'bg-tertiary',
    dotAnimate: '',
    badge: 'bg-tertiary/20 text-tertiary',
    column: '',
    border: 'border-tertiary/20',
  },
  outline: {
    dot: 'bg-outline',
    dotAnimate: '',
    badge: 'bg-surface-container-highest text-on-surface-variant',
    column: '',
    border: 'border-outline-variant/20',
  },
};

interface TaskCardProps {
  task: Task;
}

// Memoized TaskCard to prevent unnecessary re-renders
const TaskCard = memo(function TaskCard({ task }: TaskCardProps) {
  return (
    <div className="bg-surface-container p-2 rounded-lg border-l-2 border-outline-variant/30 hover:bg-surface-container-high hover:border-primary/50 transition-all group cursor-pointer">
      {/* Header */}
      <div className="flex justify-between items-start mb-1.5">
        <StateBadge state={task.state} />
        <span className="material-symbols-outlined text-on-surface-variant opacity-0 group-hover:opacity-100 cursor-pointer hover:text-on-surface" style={{ fontSize: '12px' }}>
          more_vert
        </span>
      </div>

      {/* Title */}
      <h3 className="text-xs font-semibold mb-1 text-on-surface line-clamp-2">
        {task.title || task.objective || `Task ${task.id.slice(0, 8)}`}
      </h3>

      {/* Description */}
      {task.description && (
        <p className="text-[10px] text-on-surface-variant mb-2 line-clamp-2">
          {task.description}
        </p>
      )}

      {/* Meta */}
      <div className="space-y-1 mb-2">
        {task.gitHubRepo && (
          <div className="flex items-center gap-1">
            <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: '10px' }}>folder</span>
            <code className="text-[9px] font-mono text-on-surface-variant truncate">
              {task.gitHubRepo.owner}/{task.gitHubRepo.repo}
            </code>
          </div>
        )}
        <div className="flex items-center gap-1">
          <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: '10px' }}>label</span>
          <span className="text-[9px] font-mono text-on-surface-variant">
            {task.stage || 'unknown'}
          </span>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1.5 border-t border-outline-variant/10">
        <div className="flex items-center gap-0.5">
          <span className="material-symbols-outlined text-secondary" style={{ fontSize: '10px' }}>schema</span>
          <span className="text-[9px] font-mono text-on-surface-variant">
            {task.runId ? '1 run' : 'No runs'}
          </span>
        </div>
        <button className="text-primary text-[9px] font-bold uppercase tracking-tighter hover:underline">
          View
        </button>
      </div>
    </div>
  );
});

// Memoized KanbanColumn component
export const KanbanColumn = memo(function KanbanColumn({ title, tasks, color, count }: KanbanColumnProps) {
  const config = colorConfig[color];
  const displayCount = count ?? tasks.length;

  return (
    <section className={`min-w-[160px] flex-1 max-w-[200px] flex flex-col rounded-lg ${config.column}`}>
      {/* Column Header */}
      <div className="flex items-center justify-between mb-2 px-1 pt-1">
        <div className="flex items-center gap-1">
          <span className={`w-1 h-1 rounded-full ${config.dot} ${config.dotAnimate}`} />
          <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-on-surface-variant">
            {title}
          </h2>
        </div>
        <span className={`text-xs font-mono px-1 py-0.5 rounded ${config.badge}`}>
          {displayCount.toString().padStart(2, '0')}
        </span>
      </div>

      {/* Column Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1.5 pr-0.5">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}

        {tasks.length === 0 && (
          <div className="text-center py-4 text-on-surface-variant/50 text-xs font-mono">
            No tasks
          </div>
        )}
      </div>
    </section>
  );
});