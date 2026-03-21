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

// Mock logs for demonstration
const mockLogs: LogEntry[] = [
  { timestamp: '14:22:01', level: 'INFO', message: 'Agent refactor-bot-7 successfully merged branch \'feature/auth-cleanup\'', agent: 'refactor-bot-7' },
  { timestamp: '14:22:05', level: 'DEBUG', message: 'Analyzing dependency tree for /src/hooks/use-auth.ts' },
  { timestamp: '14:22:09', level: 'WARN', message: 'Node.js memory usage exceeding 512MB threshold. Scaling sub-agents...' },
  { timestamp: '14:22:12', level: 'INFO', message: 'Unit test generator completed 14/14 suites in 3.2s' },
  { timestamp: '14:22:15', level: 'INFO', message: 'Agent test-agent-3 started processing /src/utils/validation.ts', agent: 'test-agent-3' },
  { timestamp: '14:22:18', level: 'DEBUG', message: 'Cache hit for context-bundle:task-1234' },
  { timestamp: '14:22:20', level: 'ERROR', message: 'Failed to resolve dependency: optional-package@^2.0.0' },
  { timestamp: '14:22:22', level: 'INFO', message: 'Retrying with fallback registry...', agent: 'refactor-bot-7' },
];

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
export const LogTerminal = memo(function LogTerminal({ logs = mockLogs, maxHeight = 'h-40' }: LogTerminalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const t = useTranslation();

  useEffect(() => {
    // Auto-scroll to bottom on new logs
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className={`${maxHeight} bg-surface-container-lowest rounded-lg border border-outline-variant/10 flex flex-col overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-outline-variant/20 bg-surface-container-low">
        <div className="flex items-center gap-4">
          <span className="text-primary font-bold text-xs font-mono uppercase tracking-wider">{t.systemLog}</span>
          <span className="text-on-surface-variant/50 text-[10px] font-mono">events.stream.0</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-[10px] font-mono text-on-surface-variant/60">
            {t.live}
          </span>
        </div>
      </div>

      {/* Log Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar p-3 font-mono text-[11px] space-y-1">
        {logs.map((log, index) => (
          <LogLine key={index} log={log} />
        ))}
      </div>
    </div>
  );
});