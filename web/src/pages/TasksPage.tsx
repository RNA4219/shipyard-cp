import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { TaskList } from '../components/tasks/TaskList';
import { ListTodo, Plus, Filter, X } from 'lucide-react';
import { useTranslation } from '../contexts/LanguageContext';
import { useSearch } from '../contexts/SearchContext';
import type { TaskState } from '../types';

const TASK_STATES: TaskState[] = [
  'queued',
  'planning',
  'planned',
  'developing',
  'dev_completed',
  'accepting',
  'accepted',
  'rework_required',
  'integrating',
  'integrated',
  'publish_pending_approval',
  'publishing',
  'published',
  'cancelled',
  'failed',
  'blocked',
];

export function TasksPage() {
  const t = useTranslation();
  const navigate = useNavigate();
  const { searchQuery } = useSearch();
  const [selectedState, setSelectedState] = useState<TaskState | 'all'>('all');
  const [showFilters, setShowFilters] = useState(false);

  const hasActiveFilters = selectedState !== 'all' || searchQuery.trim() !== '';

  const clearFilters = () => {
    setSelectedState('all');
  };

  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (selectedState !== 'all') {
      parts.push(t.filterByState);
    }
    if (searchQuery.trim()) {
      parts.push(t.search);
    }
    return parts.length > 0 ? `(${parts.length} ${parts.length === 1 ? 'filter' : 'filters'})` : '';
  }, [selectedState, searchQuery, t.filterByState, t.search]);

  return (
    <div className="h-full flex flex-col">
      <div className="p-2 border-b border-[#3c3c3c] bg-[#252526]">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-semibold text-white flex items-center gap-1">
            <ListTodo className="h-2.5 w-2.5" />
            {t.tasks}
          </h1>
          <button
            onClick={() => navigate('/tasks/new')}
            className="px-1.5 py-0.5 bg-[#0e639c] hover:bg-[#1177bb] rounded text-xs font-medium text-white flex items-center gap-0.5"
          >
            <Plus className="h-2 w-2" />
            {t.createTask}
          </button>
        </div>

        {/* Filter Bar */}
        <div className="mt-1.5 flex items-center gap-1">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide flex items-center gap-0.5 transition-colors ${
              hasActiveFilters
                ? 'bg-primary-container text-on-primary-container'
                : 'bg-surface-container-highest text-on-surface-variant hover:bg-surface-container'
            }`}
          >
            <Filter className="h-1.5 w-1.5" />
            {t.filterByState}
            {filterSummary && <span className="ml-0.5">{filterSummary}</span>}
          </button>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="px-1 py-0.5 rounded text-[10px] text-on-surface-variant hover:bg-surface-container flex items-center gap-0.5"
            >
              <X className="h-1.5 w-1.5" />
              {t.clearFilters}
            </button>
          )}
        </div>

        {/* Expanded Filters */}
        {showFilters && (
          <div className="mt-1.5 p-1.5 bg-surface-container rounded-lg border border-outline-variant/20">
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => setSelectedState('all')}
                className={`px-1 py-0.5 rounded text-[10px] font-mono transition-colors ${
                  selectedState === 'all'
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container-highest text-on-surface-variant hover:bg-surface-container'
                }`}
              >
                {t.all}
              </button>
              {TASK_STATES.map((state) => (
                <button
                  key={state}
                  onClick={() => setSelectedState(state)}
                  className={`px-1 py-0.5 rounded text-[10px] font-mono transition-colors ${
                    selectedState === state
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container-highest text-on-surface-variant hover:bg-surface-container'
                  }`}
                >
                  {t[state] ?? state}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        <TaskList
          filterState={selectedState !== 'all' ? selectedState : undefined}
          searchQuery={searchQuery}
        />
      </div>
    </div>
  );
}