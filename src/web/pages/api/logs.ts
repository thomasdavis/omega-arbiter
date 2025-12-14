import type { NextApiRequest, NextApiResponse } from 'next';
import pg from 'pg';

const { Pool } = pg;

interface LogEntry {
  timestamp: string;
  level: string;
  source: string;
  message: string;
  metadata?: Record<string, unknown>;
}

// Create a connection pool for the API
let pool: pg.Pool | null = null;

function getPool(): pg.Pool | null {
  if (pool) return pool;

  const host = process.env.POSTGRES_HOST;
  const password = process.env.POSTGRES_PASSWORD;

  if (!host) return null;

  pool = new Pool({
    host,
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'omega_arbiter',
    user: process.env.POSTGRES_USER || 'claudeuser',
    password,
    max: 5,
    idleTimeoutMillis: 30000,
  });

  return pool;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { limit = '100', filter = '' } = req.query;
  const limitNum = Math.min(parseInt(limit as string, 10) || 100, 1000);
  const filterStr = (filter as string).toLowerCase();

  const dbPool = getPool();

  if (!dbPool) {
    return res.status(200).json({ logs: [], total: 0, error: 'Database not configured' });
  }

  try {
    let query = `
      SELECT timestamp, log_level, source, message, metadata
      FROM bot_logs
    `;
    const params: string[] = [];

    if (filterStr) {
      query += ` WHERE LOWER(message) LIKE $1 OR LOWER(source) LIKE $1 OR LOWER(log_level) LIKE $1`;
      params.push(`%${filterStr}%`);
    }

    query += ` ORDER BY timestamp DESC LIMIT ${limitNum}`;

    const result = await dbPool.query(query, params);

    const logs: LogEntry[] = result.rows.map(row => ({
      timestamp: row.timestamp.toISOString(),
      level: row.log_level,
      source: row.source,
      message: row.message,
      metadata: row.metadata,
    }));

    res.status(200).json({ logs, total: logs.length });
  } catch (error) {
    console.error('[API] Failed to query logs:', error);
    res.status(200).json({ logs: [], total: 0, error: 'Database query failed' });
  }
}
