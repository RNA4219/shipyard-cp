import { useRunTimeline } from '../../hooks/useTasks';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { useTranslation } from '../../contexts/LanguageContext';
import type { StateTransitionEvent, TimelineResponse } from '../../types';

interface RunTimelineProps {
  runId: string;
}

// Map API state names (snake_case) to translation keys (camelCase)
function stateToTranslationKey(state: string): string {
  // Handle special cases
  const stateMap: Record<string, string> = {
    'in_progress': 'inProgress',
    'dev_completed': 'devCompleted',
    'dev_done': 'devDone',
    'publish_pending_approval': 'publishPendingApproval',
  };
  return stateMap[state] || state;
}

// Get translated state name
function getTranslatedState(state: string | undefined, t: Record<string, string>): string {
  if (!state) return '';
  const key = stateToTranslationKey(state);
  return t[key as keyof typeof t] || state;
}

// Map reason strings to translation keys
function reasonToTranslationKey(reason: string): string | null {
  const reasonMap: Record<string, string> = {
    'task created': 'reasonTaskCreated',
    'state transition': 'reasonStateTransition',
    'retry': 'reasonRetry',
    'cancellation': 'reasonCancellation',
    'error': 'reasonError',
  };
  return reasonMap[reason.toLowerCase()] || null;
}

// Get translated reason
function getTranslatedReason(reason: string | undefined, t: Record<string, string>): string | null {
  if (!reason) return null;
  const key = reasonToTranslationKey(reason);
  if (key && t[key as keyof typeof t]) {
    return t[key as keyof typeof t];
  }
  return null;
}

export function RunTimeline({ runId }: RunTimelineProps) {
  const { data, isLoading } = useRunTimeline(runId);
  const t = useTranslation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-16">
        <LoadingSpinner size="sm" />
      </div>
    );
  }

  const timeline = data as TimelineResponse | undefined;
  const events: StateTransitionEvent[] = timeline?.items ?? timeline?.events ?? [];

  if (events.length === 0) {
    return (
      <p className="text-on-surface-variant text-xs">{t.noTimelineEvents}</p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Timeline visualization */}
      <div className="relative">
        <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-outline-variant/30" />

        <div className="space-y-2">
          {events.slice().reverse().map((event) => {
            const toState = event.to_state;
            const fromState = event.from_state;
            const reason = event.reason;

            // Get translated state names
            const toStateDisplay = getTranslatedState(toState, t);
            const fromStateDisplay = getTranslatedState(fromState, t);

            // Skip redundant transition display when states are the same
            const showTransition = fromState && fromState !== toState;

            // Get translated reason
            const reasonDisplay = getTranslatedReason(reason, t);

            return (
              <div key={event.event_id} className="relative flex items-start gap-2 pl-7">
                {/* Dot */}
                <div className="absolute left-2 w-2 h-2 rounded-full border border-outline-variant bg-surface-container-high" />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-on-surface">
                      {toStateDisplay}
                    </span>
                    {showTransition && (
                      <span className="text-[10px] text-on-surface-variant">
                        ({fromStateDisplay} → {toStateDisplay})
                      </span>
                    )}
                  </div>
                  {reasonDisplay && (
                    <p className="text-[10px] text-on-surface-variant truncate">{reasonDisplay}</p>
                  )}
                  <p className="text-[9px] text-on-surface-variant/60">
                    {event.occurred_at ? new Date(event.occurred_at).toLocaleString() : ''}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
