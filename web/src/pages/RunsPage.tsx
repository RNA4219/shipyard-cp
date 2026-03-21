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
    return parts.length > 0 ? `(${parts.length})` : '';
  }, [selectedStatus, searchQuery, t.filterByStatus, t.search]);

  return (
    <div className="h-full flex flex-col">
      <div className="p-2 border-b border-[#3c3c3c] bg-[#252526]">
        <h1 className="text-sm font-semibold text-white flex items-center gap-1">
          <Activity className="h-2.5 w-2.5" />
          {t.runs}
        </h1>

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
            {t.filterByStatus}
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
                onClick={() => setSelectedStatus('all')}
                className={`px-1 py-0.5 rounded text-[10px] font-mono transition-colors ${
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
                  className={`px-1 py-0.5 rounded text-[10px] font-mono transition-colors ${
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