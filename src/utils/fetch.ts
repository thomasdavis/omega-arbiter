/**
 * HTTP Fetch Utility
 * Provides a robust fetch function with proper error handling for Omega Arbiter
 */

export interface FetchResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
  statusText?: string;
  headers?: Record<string, string>;
  responseTime: number;
}

export interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';
  headers?: Record<string, string>;
  body?: string | object;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_RETRIES = 0;
const DEFAULT_RETRY_DELAY = 1000;

/**
 * Fetch a URL with comprehensive error handling
 */
export async function fetchUrl<T = unknown>(
  url: string,
  options: FetchOptions = {}
): Promise<FetchResult<T>> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeout = DEFAULT_TIMEOUT,
    retries = DEFAULT_RETRIES,
    retryDelay = DEFAULT_RETRY_DELAY,
  } = options;

  const startTime = Date.now();
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Prepare request options
      const fetchOptions: RequestInit = {
        method,
        headers: {
          'User-Agent': 'Omega-Arbiter/1.0',
          ...headers,
        },
        signal: controller.signal,
      };

      // Add body if present
      if (body) {
        if (typeof body === 'object') {
          fetchOptions.body = JSON.stringify(body);
          fetchOptions.headers = {
            'Content-Type': 'application/json',
            ...fetchOptions.headers,
          };
        } else {
          fetchOptions.body = body;
        }
      }

      console.log(`[Fetch] ${method} ${url} (attempt ${attempt + 1}/${retries + 1})`);

      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      const responseTime = Date.now() - startTime;

      // Extract response headers
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      // Try to parse response body
      let data: T | undefined;
      const contentType = response.headers.get('content-type') || '';

      try {
        const text = await response.text();
        if (contentType.includes('application/json')) {
          data = JSON.parse(text) as T;
        } else {
          data = text as unknown as T;
        }
      } catch (parseError) {
        // If we can't parse the body, that's okay for HEAD requests or empty responses
        if (method !== 'HEAD' && response.status !== 204) {
          console.warn('[Fetch] Failed to parse response body:', parseError);
        }
      }

      // Check for HTTP errors
      if (!response.ok) {
        console.warn(`[Fetch] HTTP error: ${response.status} ${response.statusText}`);
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          statusCode: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          data,
          responseTime,
        };
      }

      console.log(`[Fetch] Success: ${response.status} (${responseTime}ms)`);
      return {
        success: true,
        data,
        statusCode: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        responseTime,
      };

    } catch (error) {
      const responseTime = Date.now() - startTime;

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          lastError = `Request timed out after ${timeout}ms`;
        } else if (error.message.includes('ECONNREFUSED')) {
          lastError = `Connection refused - server may be down or unreachable`;
        } else if (error.message.includes('ENOTFOUND')) {
          lastError = `DNS lookup failed - hostname not found`;
        } else if (error.message.includes('ETIMEDOUT')) {
          lastError = `Connection timed out`;
        } else if (error.message.includes('ECONNRESET')) {
          lastError = `Connection reset by server`;
        } else if (error.message.includes('certificate')) {
          lastError = `SSL/TLS certificate error: ${error.message}`;
        } else {
          lastError = error.message;
        }
      } else {
        lastError = String(error);
      }

      console.error(`[Fetch] Error on attempt ${attempt + 1}: ${lastError}`);

      // If we have more retries, wait and try again
      if (attempt < retries) {
        console.log(`[Fetch] Retrying in ${retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      } else {
        return {
          success: false,
          error: lastError,
          responseTime,
        };
      }
    }
  }

  // This shouldn't be reached, but TypeScript needs it
  return {
    success: false,
    error: lastError || 'Unknown error',
    responseTime: Date.now() - startTime,
  };
}

/**
 * Simple GET request
 */
export async function get<T = unknown>(
  url: string,
  options: Omit<FetchOptions, 'method' | 'body'> = {}
): Promise<FetchResult<T>> {
  return fetchUrl<T>(url, { ...options, method: 'GET' });
}

/**
 * Simple POST request
 */
export async function post<T = unknown>(
  url: string,
  body?: string | object,
  options: Omit<FetchOptions, 'method' | 'body'> = {}
): Promise<FetchResult<T>> {
  return fetchUrl<T>(url, { ...options, method: 'POST', body });
}

/**
 * Check if a URL is reachable (HEAD request)
 */
export async function isReachable(url: string, timeout = 5000): Promise<boolean> {
  const result = await fetchUrl(url, { method: 'HEAD', timeout });
  return result.success;
}

/**
 * Fetch with automatic JSON parsing
 */
export async function fetchJson<T = unknown>(
  url: string,
  options: FetchOptions = {}
): Promise<FetchResult<T>> {
  return fetchUrl<T>(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...options.headers,
    },
  });
}
