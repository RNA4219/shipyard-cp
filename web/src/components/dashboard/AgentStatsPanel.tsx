import { memo } from 'react';
import { useTranslation } from '../../contexts/LanguageContext';
import { useAgentMetrics } from '../../hooks/useAgentMetrics';

export const AgentStatsPanel = memo(function AgentStatsPanel() {
  const t = useTranslation();
  const { data, isLoading, isError } = useAgentMetrics();

  if (isLoading && !data) {
    return (
      <div className="bg-surface-container rounded-lg p-2 border border-outline-variant/10">
        <div className="flex items-center gap-2 text-on-surface-variant text-xs font-mono">
          <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span>{t.loading || 'Loading...'}</span>
        </div>
      </div>
    );
  }

  if (isError || !data || !data.scopes || !data.scopes.job) {
    return (
      <div className="bg-surface-container rounded-lg p-2 border border-outline-variant/10">
        <div className="text-xs font-mono text-on-surface-variant">
          {t.agentMetricsUnavailable || 'Agent metrics not available'}
        </div>
      </div>
    );
  }

  const jobMetrics = data.scopes.job;
  const utilizationPercent = Math.round((jobMetrics.active_agents / jobMetrics.config.max_concurrent_agents) * 100);
  const ratePercent = Math.round((jobMetrics.rate_tokens_remaining / jobMetrics.config.max_spawns_per_window) * 100);

  return (
    <div className="bg-surface-container rounded-lg p-2 border border-outline-variant/10">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold text-on-surface font-mono uppercase tracking-wide">
          {t.agentsTitle || 'Agents'}
        </h3>
        <span className="text-[10px] font-mono text-on-surface-variant">
          {new Date(data.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-2">
        {/* Active Agents */}
        <div className="bg-surface-container-high rounded p-1.5">
          <div className="text-[10px] font-mono text-on-surface-variant uppercase">{t.active || 'Active'}</div>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold text-primary font-mono">{jobMetrics.active_agents}</span>
            <span className="text-[10px] text-on-surface-variant">/ {jobMetrics.config.max_concurrent_agents}</span>
          </div>
          {/* Utilization bar */}
          <div className="mt-1 h-1 bg-surface-container rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${utilizationPercent > 80 ? 'bg-error' : utilizationPercent > 50 ? 'bg-tertiary' : 'bg-primary'}`}
              style={{ width: `${utilizationPercent}%` }}
            />
          </div>
        </div>

        {/* Rate Limit */}
        <div className="bg-surface-container-high rounded p-1.5">
          <div className="text-[10px] font-mono text-on-surface-variant uppercase">{t.rateLimit || 'Rate'}</div>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold text-tertiary font-mono">{Math.round(jobMetrics.rate_tokens_remaining)}</span>
            <span className="text-[10px] text-on-surface-variant">/ {jobMetrics.config.max_spawns_per_window}/60s</span>
          </div>
          {/* Rate bar */}
          <div className="mt-1 h-1 bg-surface-container rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${ratePercent < 20 ? 'bg-error' : ratePercent < 50 ? 'bg-tertiary' : 'bg-primary'}`}
              style={{ width: `${ratePercent}%` }}
            />
          </div>
        </div>

        {/* Spawn Stats */}
        <div className="bg-surface-container-high rounded p-1.5">
          <div className="text-[10px] font-mono text-on-surface-variant uppercase">{t.spawnStats || 'Spawns'}</div>
          <div className="flex gap-2 text-xs font-mono mt-0.5">
            <span className="text-primary">{jobMetrics.spawn_allowed}</span>
            <span className="text-secondary">{jobMetrics.spawn_queued}</span>
            <span className="text-error">{Object.values(jobMetrics.spawn_rejected).reduce((a, b) => a + b, 0)}</span>
          </div>
        </div>

        {/* Queue - Cumulative */}
        <div className="bg-surface-container-high rounded p-1.5">
          <div className="text-[10px] font-mono text-on-surface-variant uppercase">{t.queuedTotal || 'Queued Total'}</div>
          <div className="text-lg font-bold text-secondary font-mono">
            {jobMetrics.spawn_queued}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-3 mt-2 text-[9px] font-mono text-on-surface-variant">
        <span><span className="text-primary">●</span> {t.allowed || 'Allowed'}</span>
        <span><span className="text-secondary">●</span> {t.queued || 'Queued'}</span>
        <span><span className="text-error">●</span> {t.rejected || 'Rejected'}</span>
      </div>
    </div>
  );
});
