import { useEffect, useState } from 'react';
import Link from 'next/link';

interface LogEntry {
  timestamp: string;
  level: string;
  source: string;
  message: string;
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchLogs = async () => {
    try {
      const res = await fetch(`/api/logs?limit=100${filter ? `&filter=${filter}` : ''}`);
      const data = await res.json();
      setLogs(data.logs || []);
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    }
  };

  useEffect(() => {
    fetchLogs();
    if (autoRefresh) {
      const interval = setInterval(fetchLogs, 2000);
      return () => clearInterval(interval);
    }
  }, [filter, autoRefresh]);

  const getLevelColor = (level: string) => {
    switch (level.toLowerCase()) {
      case 'error': return '#ff6b6b';
      case 'warn': return '#ffd93d';
      case 'info': return '#6bcb77';
      case 'claude': return '#a855f7';
      default: return '#888';
    }
  };

  return (
    <div style={{
      fontFamily: 'monospace',
      backgroundColor: '#1a1a2e',
      color: '#eee',
      minHeight: '100vh',
      padding: '20px'
    }}>
      {/* Navigation */}
      <nav style={{
        display: 'flex',
        gap: '20px',
        marginBottom: '20px',
        padding: '10px 15px',
        backgroundColor: '#16213e',
        borderRadius: '6px'
      }}>
        <Link href="/" style={{ color: '#4da6ff', textDecoration: 'none' }}>
          Home
        </Link>
        <Link href="/logs" style={{ color: '#a855f7', textDecoration: 'none', fontWeight: 'bold' }}>
          Logs
        </Link>
        <Link href="/browse" style={{ color: '#4da6ff', textDecoration: 'none' }}>
          Browse Files
        </Link>
        <Link href="/profiles" style={{ color: '#4da6ff', textDecoration: 'none' }}>
          Profiles
        </Link>
      </nav>

      <h1 style={{ color: '#a855f7', marginBottom: '20px' }}>System Logs</h1>

      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Filter logs (e.g., Claude, Decision, Error)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            padding: '8px 12px',
            backgroundColor: '#16213e',
            border: '1px solid #444',
            color: '#eee',
            borderRadius: '4px',
            width: '300px'
          }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          Auto-refresh
        </label>
        <button
          onClick={fetchLogs}
          style={{
            padding: '8px 16px',
            backgroundColor: '#a855f7',
            border: 'none',
            color: 'white',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Refresh
        </button>
      </div>

      <div style={{
        backgroundColor: '#16213e',
        borderRadius: '8px',
        padding: '10px',
        maxHeight: '80vh',
        overflow: 'auto'
      }}>
        {logs.length === 0 ? (
          <p style={{ color: '#666' }}>No logs yet...</p>
        ) : (
          logs.map((log, i) => (
            <div key={i} style={{
              padding: '6px 10px',
              borderBottom: '1px solid #333',
              display: 'flex',
              gap: '10px'
            }}>
              <span style={{ color: '#666', minWidth: '180px' }}>
                {new Date(log.timestamp).toLocaleString()}
              </span>
              <span style={{
                color: getLevelColor(log.level),
                minWidth: '60px',
                fontWeight: 'bold'
              }}>
                [{log.level}]
              </span>
              <span style={{ color: '#4da6ff', minWidth: '100px' }}>
                {log.source}
              </span>
              <span style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
