/**
 * Log Store for Omega Arbiter
 * In-memory log storage with PostgreSQL persistence support
 */

import { insertLog, isDbAvailable, queryLogs, type DbLogEntry } from '../db/index.js';

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'system' | 'claude' | 'message';
  source: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface LogContext {
  sessionId?: string;
  channelId?: string;
  userId?: string;
}

export class LogStore {
  private logs: LogEntry[] = [];
  private maxLogs: number;
  private currentContext: LogContext = {};

  constructor(maxLogs = 10000) {
    this.maxLogs = maxLogs;
  }

  /**
   * Set context for subsequent log entries (session, channel, user)
   */
  setContext(context: LogContext): void {
    this.currentContext = { ...this.currentContext, ...context };
  }

  /**
   * Clear the current logging context
   */
  clearContext(): void {
    this.currentContext = {};
  }

  private addLog(level: LogEntry['level'], source: string, message: string, metadata?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      source,
      message,
      metadata,
    };

    this.logs.push(entry);

    // Trim old logs if we exceed the limit
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Also persist to PostgreSQL if available (non-blocking)
    if (isDbAvailable()) {
      insertLog({
        level,
        source,
        message,
        metadata,
        sessionId: this.currentContext.sessionId,
        channelId: this.currentContext.channelId,
        userId: this.currentContext.userId,
      }).catch(() => {
        // Silently ignore DB errors - already logged in insertLog
      });
    }
  }

  info(source: string, message: string, metadata?: Record<string, unknown>): void {
    this.addLog('info', source, message, metadata);
  }

  warn(source: string, message: string, metadata?: Record<string, unknown>): void {
    this.addLog('warn', source, message, metadata);
  }

  error(source: string, message: string, metadata?: Record<string, unknown>): void {
    this.addLog('error', source, message, metadata);
  }

  system(source: string, message: string, metadata?: Record<string, unknown>): void {
    this.addLog('system', source, message, metadata);
  }

  claude(source: string, message: string, metadata?: Record<string, unknown>): void {
    this.addLog('claude', source, message, metadata);
  }

  message(source: string, message: string, metadata?: Record<string, unknown>): void {
    this.addLog('message', source, message, metadata);
  }

  getLogs(limit = 100): LogEntry[] {
    // Return most recent logs first
    return this.logs.slice(-limit).reverse();
  }

  getLogsByLevel(level: LogEntry['level'], limit = 100): LogEntry[] {
    return this.logs
      .filter(log => log.level === level)
      .slice(-limit)
      .reverse();
  }

  getLogsBySource(source: string, limit = 100): LogEntry[] {
    return this.logs
      .filter(log => log.source.toLowerCase().includes(source.toLowerCase()))
      .slice(-limit)
      .reverse();
  }

  /**
   * Query logs from PostgreSQL database (if available)
   * Falls back to in-memory logs if DB is not available
   */
  async getLogsFromDb(params: {
    limit?: number;
    level?: LogEntry['level'];
    source?: string;
    sessionId?: string;
  } = {}): Promise<LogEntry[]> {
    if (!isDbAvailable()) {
      // Fall back to in-memory
      let logs = this.getLogs(params.limit);
      if (params.level) {
        logs = logs.filter(l => l.level === params.level);
      }
      if (params.source) {
        logs = logs.filter(l => l.source.toLowerCase().includes(params.source!.toLowerCase()));
      }
      return logs;
    }

    const dbLogs = await queryLogs({
      limit: params.limit,
      level: params.level,
      source: params.source,
      sessionId: params.sessionId,
    });

    // Convert DB format to LogEntry format
    return dbLogs.map((dbLog: DbLogEntry): LogEntry => ({
      timestamp: dbLog.timestamp.toISOString(),
      level: dbLog.log_level as LogEntry['level'],
      source: dbLog.source,
      message: dbLog.message,
      metadata: dbLog.metadata || undefined,
    }));
  }

  clear(): void {
    this.logs = [];
  }

  getTotal(): number {
    return this.logs.length;
  }
}

// Singleton instance
let logStoreInstance: LogStore | null = null;

export function getLogStore(): LogStore {
  if (!logStoreInstance) {
    logStoreInstance = new LogStore();
  }
  return logStoreInstance;
}

/**
 * Simple log function for convenience
 * Used by server.ts and other modules that expect a simple log(level, source, message) signature
 */
export function log(level: LogEntry['level'], source: string, message: string, metadata?: Record<string, unknown>): void {
  const store = getLogStore();
  switch (level) {
    case 'info':
      store.info(source, message, metadata);
      break;
    case 'warn':
      store.warn(source, message, metadata);
      break;
    case 'error':
      store.error(source, message, metadata);
      break;
    case 'system':
      store.system(source, message, metadata);
      break;
    case 'claude':
      store.claude(source, message, metadata);
      break;
    case 'message':
      store.message(source, message, metadata);
      break;
  }
}
