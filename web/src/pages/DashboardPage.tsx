import { useEffect } from 'react';
import { KanbanBoard } from '../components/dashboard/KanbanBoard';
import { LogTerminal } from '../components/common/LogTerminal';
import { FAB } from '../components/common/FAB';
import { useTasks } from '../hooks/useTasks';
import { useTranslation } from '../contexts/LanguageContext';
import { useSearch } from '../contexts/SearchContext';

export function DashboardPage() {
  const { data, isLoading, isError, error } = useTasks();
  const t = useTranslation();
  const { clearSearch } = useSearch();

  // Clear search on Dashboard since it doesn't use search
  // This prevents unexpected filter carry-over to Tasks/Runs pages
  useEffect(() => {
    clearSearch();
  }, [clearSearch]);

  // Get tasks from data, default to empty array
  const tasks = data?.items ?? [];
  const showInitialLoading = isLoading && !data;

  // Only show full-page loading spinner on very first load (no cached data)
  if (showInitialLoading) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-on-surface-variant text-sm font-mono">{t.tasks}...</span>
        </div>
      </div>
    );
  }

  // Show error state only if we have no data and an error occurred
  if (isError && !data) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4 text-error">
          <span className="material-symbols-outlined text-4xl">error</span>
          <span className="text-sm font-mono">
            {error?.message || 'Unable to connect to server'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col p-3">
      {/* Kanban Board */}
      <div className="flex-1 min-h-0">
        <KanbanBoard tasks={tasks} />
      </div>

      {/* Log Terminal */}
      <div className="mt-3">
        <LogTerminal maxHeight="h-20" />
      </div>

      {/* FAB */}
      <FAB />
    </div>
  );
}
