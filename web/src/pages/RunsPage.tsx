import { useState, useMemo } from 'react';
import { RunList } from '../components/runs/RunList';
import { Activity, Filter, X } from 'lucide-react';
import { useTranslation } from '../contexts/LanguageContext';
import { useSearch } from '../contexts/SearchContext';
import type { RunStatus } from '../types';

const RUN_STATUSES: RunStatus[] = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'blocked',
  'cancelled',
];

export function RunsPage() {
  const t = useTranslation();
  const { searchQuery } = useSearch();
  const [selectedStatus, setSelectedStatus] = useState<RunStatus | 'all'>('all');
  const [showFilters, setShowFilters] = useState(false);

  const hasActiveFilters = selectedStatus !== 'all' || searchQuery.trim() !== '';

  const clearFilters = () => {
    setSelectedStatus('all');
  };

  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (selectedStatus !== 'all') {
      parts.push(t.filterByStatus);
    }
    if (searchQuery.trim()) {
      parts.push(t.search);
    }
    return parts.length > 0 ? `(${parts.length} ${parts.length === 1 ? 'filter' : 'filters'})` : '';
  }, [selectedStatus, searchQuery, t.filterByStatus, t.search]);

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-[#3c3c3c] bg-[#252526]">
        <h1 className="text-lg font-semibold text-white flex items-center gap-2">
          <Activity className="h-5 w-5" />
          {t.runs}
        </h1>

        {/* Filter Bar */}
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`px-3 py-1.5 rounded text-xs font-mono uppercase tracking-wide flex items-center gap-1 transition-colors ${
              hasActiveFilters
                ? 'bg-primary-container text-on-primary-container'
                : 'bg-surface-container-highest text-on-surface-variant hover:bg-surface-container'
            }`}
          >
            <Filter className="h-3.5 w-3.5" />
            {t.filterByStatus}
            {filterSummary && <span className="ml-1">{filterSummary}</span>}
          </button>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="px-2 py-1 rounded text-xs text-on-surface-variant hover:bg-surface-container flex items-center gap-1"
            >
              <X className="h-3.5 w-3.5" />
              {t.clearFilters}
            </button>
          )}
        </div>

        {/* Expanded Filters */}
        {showFilters && (
          <div className="mt-3 p-3 bg-surface-container rounded-lg border border-outline-variant/20">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedStatus('all')}
                className={`px-2 py-1 rounded text-xs font-mono transition-colors ${
                  selectedStatus === 'all'
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container-highest text-on-surface-variant hover:bg-surface-container'
                }`}
              >
                {t.all}
              </button>
              {RUN_STATUSES.map((status) => (
                <button
                  key={status}
                  onClick={() => setSelectedStatus(status)}
                  className={`px-2 py-1 rounded text-xs font-mono transition-colors ${
                    selectedStatus === status
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container-highest text-on-surface-variant hover:bg-surface-container'
                  }`}
                >
                  {t[status] ?? status}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        <RunList
          filterStatus={selectedStatus !== 'all' ? selectedStatus : undefined}
          searchQuery={searchQuery}
        />
      </div>
    </div>
  );
}