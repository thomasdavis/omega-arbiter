/**
 * PostgreSQL Database Module for Omega Arbiter
 * Handles connection pooling and database operations
 */

import pg from 'pg';

const { Pool } = pg;

export interface DbConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean | { rejectUnauthorized: boolean };
  max?: number; // Maximum number of connections in pool
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

let pool: pg.Pool | null = null;
let isInitialized = false;

/**
 * Get database configuration from environment variables
 * Returns null if no database is configured
 */
function getDbConfig(): DbConfig | null {
  // If DATABASE_URL is provided, use it directly
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true'
        ? { rejectUnauthorized: false }
        : false,
      max: parseInt(process.env.DATABASE_POOL_SIZE || '10', 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };
  }

  // Only use individual env vars if POSTGRES_HOST is explicitly set
  if (process.env.POSTGRES_HOST) {
    return {
      host: process.env.POSTGRES_HOST,
      port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
      database: process.env.POSTGRES_DB || 'omega_arbiter',
      user: process.env.POSTGRES_USER || 'omega',
      password: process.env.POSTGRES_PASSWORD,
      ssl: process.env.DATABASE_SSL === 'true'
        ? { rejectUnauthorized: false }
        : false,
      max: parseInt(process.env.DATABASE_POOL_SIZE || '10', 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };
  }

  // No database configured
  return null;
}

/**
 * Initialize the database connection pool
 */
export async function initializeDb(): Promise<boolean> {
  if (pool) {
    return true;
  }

  const config = getDbConfig();

  // Check if we have necessary config
  if (!config) {
    console.log('[DB] No database configuration found, PostgreSQL logging disabled');
    return false;
  }

  try {
    pool = new Pool(config);

    // Test the connection
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();

    // Create the logs table if it doesn't exist
    await createLogsTable();

    isInitialized = true;
    console.log('[DB] PostgreSQL connection pool initialized');
    return true;
  } catch (error) {
    console.error('[DB] Failed to initialize PostgreSQL:', error);
    pool = null;
    return false;
  }
}

/**
 * Create the bot_logs table if it doesn't exist
 */
async function createLogsTable(): Promise<void> {
  if (!pool) return;

  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS bot_logs (
      id SERIAL PRIMARY KEY,
      timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      log_level VARCHAR(50) NOT NULL,
      source VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      metadata JSONB,
      session_id VARCHAR(100),
      channel_id VARCHAR(100),
      user_id VARCHAR(100)
    );

    -- Create indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_bot_logs_timestamp ON bot_logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_bot_logs_level ON bot_logs(log_level);
    CREATE INDEX IF NOT EXISTS idx_bot_logs_source ON bot_logs(source);
    CREATE INDEX IF NOT EXISTS idx_bot_logs_session_id ON bot_logs(session_id);
  `;

  try {
    await pool.query(createTableQuery);
    console.log('[DB] bot_logs table ready');
  } catch (error) {
    console.error('[DB] Failed to create logs table:', error);
    throw error;
  }
}

/**
 * Get the database pool (may be null if not configured)
 */
export function getPool(): pg.Pool | null {
  return pool;
}

/**
 * Check if database is initialized and available
 */
export function isDbAvailable(): boolean {
  return isInitialized && pool !== null;
}

/**
 * Insert a log entry into the database
 */
export interface LogInsertParams {
  level: string;
  source: string;
  message: string;
  metadata?: Record<string, unknown>;
  sessionId?: string;
  channelId?: string;
  userId?: string;
}

export async function insertLog(params: LogInsertParams): Promise<void> {
  if (!pool || !isInitialized) return;

  const { level, source, message, metadata, sessionId, channelId, userId } = params;

  try {
    await pool.query(
      `INSERT INTO bot_logs (log_level, source, message, metadata, session_id, channel_id, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        level,
        source,
        message,
        metadata ? JSON.stringify(metadata) : null,
        sessionId || null,
        channelId || null,
        userId || null,
      ]
    );
  } catch (error) {
    // Log to console but don't throw - we don't want DB errors to crash the bot
    console.error('[DB] Failed to insert log:', error);
  }
}

/**
 * Query logs from the database
 */
export interface LogQueryParams {
  limit?: number;
  offset?: number;
  level?: string;
  source?: string;
  sessionId?: string;
  startTime?: Date;
  endTime?: Date;
}

export interface DbLogEntry {
  id: number;
  timestamp: Date;
  log_level: string;
  source: string;
  message: string;
  metadata: Record<string, unknown> | null;
  session_id: string | null;
  channel_id: string | null;
  user_id: string | null;
}

export async function queryLogs(params: LogQueryParams = {}): Promise<DbLogEntry[]> {
  if (!pool || !isInitialized) return [];

  const { limit = 100, offset = 0, level, source, sessionId, startTime, endTime } = params;

  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (level) {
    conditions.push(`log_level = $${paramIndex++}`);
    values.push(level);
  }

  if (source) {
    conditions.push(`source ILIKE $${paramIndex++}`);
    values.push(`%${source}%`);
  }

  if (sessionId) {
    conditions.push(`session_id = $${paramIndex++}`);
    values.push(sessionId);
  }

  if (startTime) {
    conditions.push(`timestamp >= $${paramIndex++}`);
    values.push(startTime);
  }

  if (endTime) {
    conditions.push(`timestamp <= $${paramIndex++}`);
    values.push(endTime);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  values.push(limit);
  values.push(offset);

  try {
    const result = await pool.query<DbLogEntry>(
      `SELECT * FROM bot_logs ${whereClause} ORDER BY timestamp DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      values
    );
    return result.rows;
  } catch (error) {
    console.error('[DB] Failed to query logs:', error);
    return [];
  }
}

/**
 * Get total log count (for pagination)
 */
export async function getLogCount(params: Omit<LogQueryParams, 'limit' | 'offset'> = {}): Promise<number> {
  if (!pool || !isInitialized) return 0;

  const { level, source, sessionId, startTime, endTime } = params;

  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (level) {
    conditions.push(`log_level = $${paramIndex++}`);
    values.push(level);
  }

  if (source) {
    conditions.push(`source ILIKE $${paramIndex++}`);
    values.push(`%${source}%`);
  }

  if (sessionId) {
    conditions.push(`session_id = $${paramIndex++}`);
    values.push(sessionId);
  }

  if (startTime) {
    conditions.push(`timestamp >= $${paramIndex++}`);
    values.push(startTime);
  }

  if (endTime) {
    conditions.push(`timestamp <= $${paramIndex++}`);
    values.push(endTime);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM bot_logs ${whereClause}`,
      values
    );
    return parseInt(result.rows[0].count, 10);
  } catch (error) {
    console.error('[DB] Failed to get log count:', error);
    return 0;
  }
}

/**
 * Get all table names in the public schema
 */
export interface TableInfo {
  table_name: string;
  table_type: string;
}

export async function getTables(): Promise<TableInfo[]> {
  if (!pool || !isInitialized) {
    return [];
  }

  try {
    const result = await pool.query<TableInfo>(
      `SELECT table_name, table_type
       FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`
    );
    return result.rows;
  } catch (error) {
    console.error('[DB] Failed to query tables:', error);
    return [];
  }
}

/**
 * Close the database connection pool
 */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    isInitialized = false;
    console.log('[DB] PostgreSQL connection pool closed');
  }
}
