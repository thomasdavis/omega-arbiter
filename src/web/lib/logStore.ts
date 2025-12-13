/**
 * Log Store - Collects and stores all bot logs for the dashboard
 */

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug' | 'claude';
  source: string;
  message: string;
}

class LogStore {
  private logs: LogEntry[] = [];
  private maxLogs = 5000;

  add(level: LogEntry['level'], source: string, message: string): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      source,
      message: typeof message === 'string' ? message : JSON.stringify(message),
    };

    this.logs.unshift(entry);

    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }
  }

  getLogs(limit: number = 100): LogEntry[] {
    return this.logs.slice(0, limit);
  }

  clear(): void {
    this.logs = [];
  }
}

// Singleton instance
let store: LogStore | null = null;

export function getLogStore(): LogStore {
  if (!store) {
    store = new LogStore();
  }
  return store;
}
