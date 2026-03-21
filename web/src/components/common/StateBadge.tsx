import { memo } from 'react';
import type { TaskState, RiskLevel } from '../../types';

interface StateBadgeProps {
  state: TaskState;
  size?: 'sm' | 'md';
  className?: string;
}

interface StateConfig {
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
  animate: boolean;
}

const stateConfigs: Record<TaskState, StateConfig> = {
  queued: {
    color: 'text-outline',
    bgColor: 'bg-outline/10',
    borderColor: 'border-outline/30',
    label: 'QUEUED',
    animate: false,
  },
  planning: {
    color: 'text-secondary',
    bgColor: 'bg-secondary/10',
    borderColor: 'border-secondary/30',
    label: 'PLANNING',
    animate: true,
  },
  planned: {
    color: 'text-secondary',
    bgColor: 'bg-secondary/10',
    borderColor: 'border-secondary/30',
    label: 'PLANNED',
    animate: false,
  },
  developing: {
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    borderColor: 'border-primary/30',
    label: 'DEVELOPING',
    animate: true,
  },
  dev_completed: {
    color: 'text-primary-dim',
    bgColor: 'bg-primary/10',
    borderColor: 'border-primary/30',
    label: 'DEV DONE',
    animate: false,
  },
  accepting: {
    color: 'text-tertiary',
    bgColor: 'bg-tertiary/10',
    borderColor: 'border-tertiary/30',
    label: 'ACCEPTING',
    animate: true,
  },
  accepted: {
    color: 'text-tertiary',
    bgColor: 'bg-tertiary/10',
    borderColor: 'border-tertiary/30',
    label: 'ACCEPTED',
    animate: false,
  },
  rework_required: {
    color: 'text-error',
    bgColor: 'bg-error/10',
    borderColor: 'border-error/30',
    label: 'REWORK',
    animate: false,
  },
  integrating: {
    color: 'text-secondary-dim',
    bgColor: 'bg-secondary/10',
    borderColor: 'border-secondary/30',
    label: 'INTEGRATING',
    animate: true,
  },
  integrated: {
    color: 'text-secondary',
    bgColor: 'bg-secondary/10',
    borderColor: 'border-secondary/30',
    label: 'INTEGRATED',
    animate: false,
  },
  publish_pending_approval: {
    color: 'text-tertiary-dim',
    bgColor: 'bg-tertiary/10',
    borderColor: 'border-tertiary/30',
    label: 'AWAITING APPROVAL',
    animate: true,
  },
  publishing: {
    color: 'text-tertiary',
    bgColor: 'bg-tertiary/10',
    borderColor: 'border-tertiary/30',
    label: 'PUBLISHING',
    animate: true,
  },
  published: {
    color: 'text-tertiary',
    bgColor: 'bg-tertiary/10',
    borderColor: 'border-tertiary/30',
    label: 'PUBLISHED',
    animate: false,
  },
  cancelled: {
    color: 'text-outline',
    bgColor: 'bg-outline/10',
    borderColor: 'border-outline/30',
    label: 'CANCELLED',
    animate: false,
  },
  failed: {
    color: 'text-error',
    bgColor: 'bg-error/10',
    borderColor: 'border-error/30',
    label: 'FAILED',
    animate: false,
  },
  blocked: {
    color: 'text-secondary-dim',
    bgColor: 'bg-secondary/10',
    borderColor: 'border-secondary/30',
    label: 'BLOCKED',
    animate: false,
  },
};

// Memoized StateBadge component
export const StateBadge = memo(function StateBadge({ state, size = 'sm', className }: StateBadgeProps) {
  const config = stateConfigs[state] || stateConfigs.queued;

  return (
    <span
      className={`
        inline-flex items-center gap-1 font-mono rounded border
        ${config.color} ${config.bgColor} ${config.borderColor}
        ${size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1'}
        ${className || ''}
      `}
    >
      {config.animate && (
        <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${config.color.replace('text-', 'bg-')}`} />
      )}
      {config.label}
    </span>
  );
});

interface RiskBadgeProps {
  risk: RiskLevel;
  className?: string;
}

const riskConfigs: Record<RiskLevel, { color: string; bgColor: string }> = {
  low: { color: 'text-tertiary', bgColor: 'bg-tertiary/10' },
  medium: { color: 'text-secondary', bgColor: 'bg-secondary/10' },
  high: { color: 'text-error', bgColor: 'bg-error/10' },
};

// Memoized RiskBadge component
export const RiskBadge = memo(function RiskBadge({ risk, className }: RiskBadgeProps) {
  const config = riskConfigs[risk] || riskConfigs.low;

  return (
    <span
      className={`
        inline-flex items-center px-2 py-0.5 rounded text-xs font-mono border border-outline-variant/20
        ${config.color} ${config.bgColor}
        ${className || ''}
      `}
    >
      {risk.toUpperCase()}
    </span>
  );
});