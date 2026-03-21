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

  const events = data?.items ?? data?.events ?? [];

  if (events.length === 0) {
    return (
      <p className="text-gray-500 text-sm">{t.noTimelineEvents}</p>
    );
  }

  // Find the current state (last event's to_state)
  const lastEvent = events[events.length - 1];
  const currentState = lastEvent?.payload?.to_state as string | undefined;

  return (
    <div className="space-y-4">
      {/* Timeline visualization */}
      <div className="relative">
        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-[#3c3c3c]" />

        <div className="space-y-2">
          {events.slice().reverse().map((event) => {
            const toState = event.payload?.to_state as string | undefined;
            const isLast = toState === currentState;

            return (
              <div key={event.id ?? event.event_id} className="relative flex items-start gap-3 pl-10">
                {/* Dot */}
                <div className="absolute left-2.5 w-3 h-3 rounded-full border-2 border-[#3c3c3c] bg-[#1e1e1e]" />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-200">
                      {toState ?? event.type}
                    </span>
                    {isLast && (
                      <span className="text-xs text-blue-400">({t.current})</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate">{(event.payload?.reason as string) ?? ''}</p>
                  <p className="text-xs text-gray-600">
                    {new Date(event.timestamp ?? event.occurred_at ?? '').toLocaleString()}
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