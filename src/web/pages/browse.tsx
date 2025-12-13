import { useEffect, useState } from 'react';
import Link from 'next/link';

interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
}

interface BrowseResponse {
  path: string;
  entries: FileEntry[];
  error?: string;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleString();
}

export default function BrowsePage() {
  const [currentPath, setCurrentPath] = useState('.');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDirectory = async (dirPath: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/browse?path=${encodeURIComponent(dirPath)}`);
      const data: BrowseResponse = await res.json();

      if (data.error) {
        setError(data.error);
        setEntries([]);
      } else {
        setCurrentPath(data.path);
        setEntries(data.entries);
      }
    } catch (err) {
      setError('Failed to fetch directory contents');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDirectory('.');
  }, []);

  const navigateTo = (name: string) => {
    const newPath = currentPath === '.' ? name : `${currentPath}/${name}`;
    fetchDirectory(newPath);
  };

  const navigateUp = () => {
    if (currentPath === '.') return;
    const parts = currentPath.split('/');
    parts.pop();
    const newPath = parts.length === 0 ? '.' : parts.join('/');
    fetchDirectory(newPath);
  };

  const navigateToRoot = () => {
    fetchDirectory('.');
  };

  const pathParts = currentPath === '.' ? [] : currentPath.split('/');

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
        <Link href="/logs" style={{ color: '#4da6ff', textDecoration: 'none' }}>
          Logs
        </Link>
        <Link href="/browse" style={{ color: '#a855f7', textDecoration: 'none', fontWeight: 'bold' }}>
          Browse Files
        </Link>
      </nav>

      <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '20px' }}>
        <h1 style={{ color: '#a855f7', margin: 0 }}>Browse Files</h1>
      </div>

      {/* Breadcrumb navigation */}
      <div style={{
        backgroundColor: '#16213e',
        padding: '10px 15px',
        borderRadius: '6px',
        marginBottom: '15px',
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        flexWrap: 'wrap'
      }}>
        <span
          onClick={navigateToRoot}
          style={{
            color: currentPath === '.' ? '#a855f7' : '#4da6ff',
            cursor: currentPath === '.' ? 'default' : 'pointer',
            fontWeight: currentPath === '.' ? 'bold' : 'normal'
          }}
        >
          root
        </span>
        {pathParts.map((part, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ color: '#666' }}>/</span>
            <span
              onClick={() => {
                const newPath = pathParts.slice(0, i + 1).join('/');
                fetchDirectory(newPath);
              }}
              style={{
                color: i === pathParts.length - 1 ? '#a855f7' : '#4da6ff',
                cursor: i === pathParts.length - 1 ? 'default' : 'pointer',
                fontWeight: i === pathParts.length - 1 ? 'bold' : 'normal'
              }}
            >
              {part}
            </span>
          </span>
        ))}
      </div>

      {/* Action bar */}
      <div style={{ marginBottom: '15px', display: 'flex', gap: '10px' }}>
        <button
          onClick={navigateUp}
          disabled={currentPath === '.'}
          style={{
            padding: '8px 16px',
            backgroundColor: currentPath === '.' ? '#333' : '#a855f7',
            border: 'none',
            color: 'white',
            borderRadius: '4px',
            cursor: currentPath === '.' ? 'not-allowed' : 'pointer',
            opacity: currentPath === '.' ? 0.5 : 1
          }}
        >
          &uarr; Up
        </button>
        <button
          onClick={() => fetchDirectory(currentPath)}
          style={{
            padding: '8px 16px',
            backgroundColor: '#16213e',
            border: '1px solid #444',
            color: 'white',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Refresh
        </button>
      </div>

      {/* Error display */}
      {error && (
        <div style={{
          backgroundColor: '#ff6b6b22',
          border: '1px solid #ff6b6b',
          color: '#ff6b6b',
          padding: '15px',
          borderRadius: '6px',
          marginBottom: '15px'
        }}>
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div style={{ color: '#666', padding: '20px' }}>
          Loading...
        </div>
      )}

      {/* File listing */}
      {!loading && !error && (
        <div style={{
          backgroundColor: '#16213e',
          borderRadius: '8px',
          overflow: 'hidden'
        }}>
          {/* Header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '40px 1fr 100px 180px',
            padding: '12px 15px',
            backgroundColor: '#0f1629',
            borderBottom: '1px solid #333',
            fontWeight: 'bold',
            color: '#888'
          }}>
            <span></span>
            <span>Name</span>
            <span>Size</span>
            <span>Modified</span>
          </div>

          {/* Empty state */}
          {entries.length === 0 && (
            <div style={{ padding: '20px', color: '#666', textAlign: 'center' }}>
              This directory is empty
            </div>
          )}

          {/* Entries */}
          {entries.map((entry) => (
            <div
              key={entry.name}
              onClick={() => entry.type === 'directory' && navigateTo(entry.name)}
              style={{
                display: 'grid',
                gridTemplateColumns: '40px 1fr 100px 180px',
                padding: '10px 15px',
                borderBottom: '1px solid #333',
                cursor: entry.type === 'directory' ? 'pointer' : 'default',
                transition: 'background-color 0.15s ease'
              }}
              onMouseEnter={(e) => {
                if (entry.type === 'directory') {
                  e.currentTarget.style.backgroundColor = '#1e2a4a';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <span style={{ fontSize: '18px' }}>
                {entry.type === 'directory' ? '📁' : '📄'}
              </span>
              <span style={{
                color: entry.type === 'directory' ? '#4da6ff' : '#eee',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {entry.name}
              </span>
              <span style={{ color: '#888' }}>
                {entry.type === 'file' ? formatSize(entry.size) : '-'}
              </span>
              <span style={{ color: '#666' }}>
                {formatDate(entry.modified)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Stats */}
      {!loading && !error && (
        <div style={{ marginTop: '15px', color: '#666', fontSize: '12px' }}>
          {entries.filter(e => e.type === 'directory').length} directories,{' '}
          {entries.filter(e => e.type === 'file').length} files
        </div>
      )}
    </div>
  );
}
