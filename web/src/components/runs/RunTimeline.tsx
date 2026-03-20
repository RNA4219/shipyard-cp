import { useRunTimeline } from '../../hooks/useTasks';
import { LoadingSpinner } from '../common/LoadingSpinner';

interface RunTimelineProps {
  runId: string;
}

export function RunTimeline({ runId }: RunTimelineProps) {
  const { data, isLoading } = useRunTimeline(runId);

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
      <p className="text-gray-500 text-sm">No timeline events</p>
    );
  }

  // Find the current state (last event's to_state)
  const currentState = events[events.length - 1]?.to_state;

  return (
    <div className="space-y-4">
      {/* Timeline visualization */}
      <div className="relative">
        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-[#3c3c3c]" />

        <div className="space-y-2">
          {events.slice().reverse().map((event) => {
            const isLast = event.to_state === currentState;

            return (
              <div key={event.event_id} className="relative flex items-start gap-3 pl-10">
                {/* Dot */}
                <div className="absolute left-2.5 w-3 h-3 rounded-full border-2 border-[#3c3c3c] bg-[#1e1e1e]" />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-200">
                      {event.to_state}
                    </span>
                    {isLast && (
                      <span className="text-xs text-blue-400">(current)</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate">{event.reason}</p>
                  <p className="text-xs text-gray-600">
                    {new Date(event.occurred_at).toLocaleString()}
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