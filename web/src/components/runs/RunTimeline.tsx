import { useRunTimeline } from '../../hooks/useTasks';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { useTranslation } from '../../contexts/LanguageContext';

interface RunTimelineProps {
  runId: string;
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

  const events = data?.items ?? [];

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
            // Extract state from payload if available
            const payload = event.payload as Record<string, unknown> | undefined;
            const toState = (payload?.to_state ?? event.type) as string | undefined;
            const fromState = payload?.from_state as string | undefined;
            const reason = payload?.reason as string | undefined;
            const displayLabel = toState ?? 'Event';

            return (
              <div key={event.event_id ?? event.id ?? `${event.timestamp}-${toState}`} className="relative flex items-start gap-2 pl-7">
                {/* Dot */}
                <div className="absolute left-2 w-2 h-2 rounded-full border border-outline-variant bg-surface-container-high" />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-on-surface">
                      {displayLabel}
                    </span>
                    {fromState && toState && (
                      <span className="text-[10px] text-on-surface-variant">
                        ({fromState} → {toState})
                      </span>
                    )}
                  </div>
                  {reason && (
                    <p className="text-[10px] text-on-surface-variant truncate">{reason}</p>
                  )}
                  <p className="text-[9px] text-on-surface-variant/60">
                    {event.occurred_at ?? event.timestamp ? new Date(event.occurred_at ?? event.timestamp).toLocaleString() : ''}
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