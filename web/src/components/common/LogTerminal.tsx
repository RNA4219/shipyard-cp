import { memo, useEffect, useRef } from 'react';
import { useTranslation } from '../../contexts/LanguageContext';

interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'DEBUG' | 'WARN' | 'ERROR';
  message: string;
  agent?: string;
}

interface LogTerminalProps {
  logs?: LogEntry[];
  maxHeight?: string;
}

const levelColors: Record<LogEntry['level'], string> = {
  INFO: 'text-on-surface',
  DEBUG: 'text-secondary',
  WARN: 'text-error',
  ERROR: 'text-error bg-error/10 px-1 rounded',
};

interface LogLineProps {
  log: LogEntry;
}

// Memoized log line to prevent unnecessary re-renders
const LogLine = memo(function LogLine({ log }: LogLineProps) {
  return (
    <div className="flex gap-2 flex-wrap">
      <span className="text-tertiary">[{log.timestamp}]</span>
      <span className={levelColors[log.level]}>{log.level}:</span>
      {log.agent && (
        <span className="text-primary">{log.agent}</span>
      )}
      <span className="text-on-surface-variant/80">{log.message}</span>
    </div>
  );
});

// Memoized LogTerminal component
export const LogTerminal = memo(function LogTerminal({ logs, maxHeight = 'h-40' }: LogTerminalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const t = useTranslation();

  useEffect(() => {
    // Auto-scroll to bottom on new logs
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  // 実データがない場合は空状態を表示
  const hasRealLogs = logs && logs.length > 0;

  return (
    <div className={`${maxHeight} bg-surface-container-lowest rounded-lg border border-outline-variant/10 flex flex-col overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-outline-variant/20 bg-surface-container-low">
        <div className="flex items-center gap-2">
          <span className="text-primary font-bold text-[10px] font-mono uppercase tracking-wider">{t.systemLog}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-outline" />
        </div>
      </div>

      {/* Log Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar p-1.5 font-mono text-[9px] space-y-0.5">
        {hasRealLogs ? (
          logs.map((log, index) => (
            <LogLine key={index} log={log} />
          ))
        ) : (
          <div className="flex items-center justify-center h-full text-on-surface-variant text-xs">
            {t.noEvents || 'No events available'}
          </div>
        )}
      </div>
    </div>
  );
});
