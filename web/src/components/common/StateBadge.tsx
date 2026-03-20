import clsx from 'clsx';
import type { TaskState, RiskLevel } from '../../types';

interface StateBadgeProps {
  state: TaskState;
  className?: string;
}

export function StateBadge({ state, className }: StateBadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
        `state-${state}`,
        className
      )}
    >
      {state.replace(/_/g, ' ')}
    </span>
  );
}

interface RiskBadgeProps {
  risk: RiskLevel;
  className?: string;
}

export function RiskBadge({ risk, className }: RiskBadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border',
        `risk-${risk}`,
        className
      )}
    >
      {risk}
    </span>
  );
}