import type { NextApiRequest, NextApiResponse } from 'next';
import { fetchUrl, fetchJson, FetchResult, FetchOptions } from '../../../utils/fetch';

interface FetchApiResponse extends FetchResult {
  json?: unknown;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<FetchApiResponse | { error: string }>
) {
  // Only allow POST requests for security
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const { url, options, parseJson } = req.body as {
    url?: string;
    options?: FetchOptions;
    parseJson?: boolean;
  };

  if (!url) {
    return res.status(400).json({ error: 'Missing required field: url' });
  }

  // Validate URL format
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: `Invalid URL format: ${url}` });
  }

  // Apply default options with user overrides
  const fetchOptions: FetchOptions = {
    timeout: options?.timeout ?? 30000,
    maxSize: options?.maxSize ?? 10 * 1024 * 1024,
    followRedirects: options?.followRedirects ?? true,
    headers: options?.headers ?? {},
  };

  try {
    let result: FetchApiResponse;

    if (parseJson) {
      result = await fetchJson(url, fetchOptions);
    } else {
      result = await fetchUrl(url, fetchOptions);
    }

    // Set appropriate status code based on result
    const statusCode = result.success ? 200 : (result.errorType === 'HTTP_ERROR' ? result.statusCode || 502 : 502);

    return res.status(statusCode).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: `Fetch failed: ${message}` });
  }
}
