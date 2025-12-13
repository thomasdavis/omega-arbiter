import type { NextApiRequest, NextApiResponse } from 'next';
import { promises as fs } from 'fs';
import path from 'path';

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

// Root directory - the project root
const ROOT_DIR = process.cwd();

// Directories/files that should be hidden for security
const HIDDEN_PATTERNS = [
  /^\.env/,
  /^\.git$/,
  /node_modules$/,
  /^\.next$/,
  /\.log$/,
];

function isHidden(name: string): boolean {
  return HIDDEN_PATTERNS.some(pattern => pattern.test(name));
}

function sanitizePath(requestedPath: string): string {
  // Normalize and resolve the path
  const normalized = path.normalize(requestedPath).replace(/^(\.\.[\/\\])+/, '');
  // Ensure we stay within ROOT_DIR
  const fullPath = path.resolve(ROOT_DIR, normalized);

  // Prevent directory traversal
  if (!fullPath.startsWith(ROOT_DIR)) {
    return ROOT_DIR;
  }

  return fullPath;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BrowseResponse>
) {
  const { path: requestedPath = '' } = req.query;
  const pathStr = Array.isArray(requestedPath) ? requestedPath.join('/') : requestedPath;

  try {
    const fullPath = sanitizePath(pathStr);
    const relativePath = path.relative(ROOT_DIR, fullPath) || '.';

    const stat = await fs.stat(fullPath);

    if (!stat.isDirectory()) {
      return res.status(400).json({
        path: relativePath,
        entries: [],
        error: 'Requested path is not a directory',
      });
    }

    const dirEntries = await fs.readdir(fullPath, { withFileTypes: true });

    const entries: FileEntry[] = [];

    for (const entry of dirEntries) {
      // Skip hidden files/directories
      if (isHidden(entry.name)) {
        continue;
      }

      try {
        const entryPath = path.join(fullPath, entry.name);
        const entryStat = await fs.stat(entryPath);

        entries.push({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: entryStat.size,
          modified: entryStat.mtime.toISOString(),
        });
      } catch {
        // Skip entries we can't stat
        continue;
      }
    }

    // Sort: directories first, then alphabetically
    entries.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    res.status(200).json({
      path: relativePath,
      entries,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({
      path: pathStr,
      entries: [],
      error: `Failed to browse directory: ${message}`,
    });
  }
}
