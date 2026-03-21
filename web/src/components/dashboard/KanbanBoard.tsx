import { useMemo, useCallback } from 'react';
import { KanbanColumn } from './KanbanColumn';
import { useTranslation } from '../../contexts/LanguageContext';
import type { Task, TaskState } from '../../types';

interface KanbanBoardProps {
  tasks: Task[];
}

// Column states configuration
const COLUMN_STATES = {
  queued: ['queued'] as TaskState[],
  planning: ['planning', 'planned'] as TaskState[],
  developing: ['developing', 'dev_completed'] as TaskState[],
  acceptance: ['accepting', 'accepted', 'rework_required'] as TaskState[],
  integrating: ['integrating', 'integrated'] as TaskState[],
  publishing: ['publish_pending_approval', 'publishing'] as TaskState[],
  published: ['published'] as TaskState[],
  failed: ['blocked', 'failed'] as TaskState[],
  cancelled: ['cancelled'] as TaskState[],
};

// Stats calculation helper
function calculateStats(tasks: Task[]) {
  const activeStates: TaskState[] = ['planning', 'planned', 'developing', 'dev_completed', 'accepting', 'integrating', 'publishing'];
  const completedStates: TaskState[] = ['published'];
  const failedStates: TaskState[] = ['failed'];
  const blockedStates: TaskState[] = ['blocked'];

  const active = tasks.filter((task) => activeStates.includes(task.state)).length;
  const completed = tasks.filter((task) => completedStates.includes(task.state)).length;
  const failed = tasks.filter((task) => failedStates.includes(task.state)).length;
  const blocked = tasks.filter((task) => blockedStates.includes(task.state)).length;
  const total = tasks.length;

  return { active, completed, failed, blocked, total };
}

// Filter tasks by states helper
function filterTasksByStates(tasks: Task[], states: TaskState[]): Task[] {
  return tasks.filter((task) => states.includes(task.state));
}

export function KanbanBoard({ tasks }: KanbanBoardProps) {
  const t = useTranslation();

  // Memoized column configuration
  const columnConfigs = useMemo(() => [
    {
      title: t.queued,
      states: COLUMN_STATES.queued,
      color: 'outline' as const,
    },
    {
      title: t.planned,
      states: COLUMN_STATES.planning,
      color: 'secondary' as const,
    },
    {
      title: t.inProgress,
      states: COLUMN_STATES.developing,
      color: 'primary' as const,
    },
    {
      title: t.acceptance,
      states: COLUMN_STATES.acceptance,
      color: 'tertiary' as const,
    },
    {
      title: t.integrating,
      states: COLUMN_STATES.integrating,
      color: 'secondary' as const,
    },
    {
      title: t.publishing,
      states: COLUMN_STATES.publishing,
      color: 'tertiary' as const,
    },
    {
      title: t.published,
      states: COLUMN_STATES.published,
      color: 'tertiary' as const,
    },
    {
      title: t.failed,
      states: COLUMN_STATES.failed,
      color: 'outline' as const,
    },
    {
      title: t.cancelled,
      states: COLUMN_STATES.cancelled,
      color: 'outline' as const,
    },
  ], [t.queued, t.planned, t.inProgress, t.acceptance, t.integrating, t.publishing, t.published, t.failed, t.cancelled]);

  // Memoized task filtering function
  const getTasksForColumn = useCallback((taskList: Task[], states: TaskState[]) => {
    return filterTasksByStates(taskList, states);
  }, []);

  // Memoized tasks by column
  const tasksByColumn = useMemo(() => {
    const result: Record<string, Task[]> = {};

    columnConfigs.forEach((column) => {
      result[column.title] = getTasksForColumn(tasks, column.states);
    });

    return result;
  }, [tasks, columnConfigs, getTasksForColumn]);

  // Memoized stats
  const stats = useMemo(() => calculateStats(tasks), [tasks]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-end justify-between mb-3 px-1">
        <div>
          <h1 className="text-lg font-extrabold tracking-tight text-on-surface mb-0.5">
            {t.welcomeTitle}
          </h1>
          <p className="text-on-surface-variant font-mono text-[16px]">
            ACTIVE_TASKS:{' '}
            <span className="text-primary">
              {stats.active}
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          {/* Stats Badges */}
          <div className="flex items-center gap-1.5 px-2 py-1 bg-surface-container rounded border border-outline-variant/20">
            <span className="text-[9px] font-mono text-on-surface-variant">{t.total}:</span>
            <span className="text-[9px] font-mono text-on-surface font-bold">{stats.total}</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 bg-primary/10 rounded border border-primary/20">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-[9px] font-mono text-primary font-bold">{stats.active} {t.active}</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 bg-tertiary/10 rounded border border-tertiary/20">
            <span className="material-symbols-outlined text-tertiary" style={{ fontSize: '12px' }}>task_alt</span>
            <span className="text-[9px] font-mono text-tertiary font-bold">{stats.completed} {t.done}</span>
          </div>
          {stats.failed > 0 && (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-error/10 rounded border border-error/20">
              <span className="material-symbols-outlined text-error" style={{ fontSize: '12px' }}>error</span>
              <span className="text-[9px] font-mono text-error font-bold">{stats.failed} {t.failed}</span>
            </div>
          )}
          {stats.blocked > 0 && (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-secondary/10 rounded border border-secondary/20">
              <span className="material-symbols-outlined text-secondary" style={{ fontSize: '12px' }}>block</span>
              <span className="text-[9px] font-mono text-secondary font-bold">{stats.blocked} {t.blocked}</span>
            </div>
          )}
        </div>
      </div>

      {/* Kanban Columns */}
      <div className="flex-1 flex gap-2 overflow-x-auto custom-scrollbar pb-2">
        {columnConfigs.map((column) => (
          <KanbanColumn
            key={column.title}
            title={column.title}
            tasks={tasksByColumn[column.title] || []}
            color={column.color}
          />
        ))}
      </div>
    </div>
  );
}
