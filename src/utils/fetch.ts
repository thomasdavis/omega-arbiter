/**
 * Fetch utility with comprehensive error handling
 */

export interface FetchResult {
  success: boolean;
  url: string;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  contentType?: string;
  data?: string;
  error?: string;
  errorType?: FetchErrorType;
  timing: {
    startTime: number;
    endTime: number;
    duration: number;
  };
}

export type FetchErrorType =
  | 'NETWORK_ERROR'     // Network connectivity issues
  | 'TIMEOUT'           // Request timed out
  | 'DNS_ERROR'         // DNS resolution failed
  | 'CONNECTION_REFUSED' // Server refused connection
  | 'SSL_ERROR'         // SSL/TLS certificate issues
  | 'INVALID_URL'       // Malformed URL
  | 'HTTP_ERROR'        // HTTP error status codes
  | 'PARSE_ERROR'       // Failed to parse response
  | 'UNKNOWN';          // Unclassified error

export interface FetchOptions {
  timeout?: number;       // Timeout in milliseconds (default: 30000)
  maxSize?: number;       // Max response size in bytes (default: 10MB)
  followRedirects?: boolean; // Follow redirects (default: true)
  headers?: Record<string, string>; // Custom headers
}

const DEFAULT_OPTIONS: Required<FetchOptions> = {
  timeout: 30000,
  maxSize: 10 * 1024 * 1024, // 10MB
  followRedirects: true,
  headers: {},
};

/**
 * Classify error type based on error message/code
 */
function classifyError(error: Error): FetchErrorType {
  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();

  if (message.includes('enotfound') || message.includes('getaddrinfo')) {
    return 'DNS_ERROR';
  }
  if (message.includes('econnrefused') || message.includes('connection refused')) {
    return 'CONNECTION_REFUSED';
  }
  if (message.includes('timeout') || message.includes('etimedout') || name.includes('timeout')) {
    return 'TIMEOUT';
  }
  if (message.includes('ssl') || message.includes('certificate') || message.includes('cert')) {
    return 'SSL_ERROR';
  }
  if (message.includes('invalid url') || message.includes('malformed')) {
    return 'INVALID_URL';
  }
  if (message.includes('econnreset') || message.includes('socket hang up')) {
    return 'NETWORK_ERROR';
  }

  return 'UNKNOWN';
}

/**
 * Extract headers as a simple object
 */
function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/**
 * Fetch a URL with comprehensive error handling
 */
export async function fetchUrl(url: string, options?: FetchOptions): Promise<FetchResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();

  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return {
      success: false,
      url,
      error: `Invalid URL: ${url}`,
      errorType: 'INVALID_URL',
      timing: {
        startTime,
        endTime: Date.now(),
        duration: Date.now() - startTime,
      },
    };
  }

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts.timeout);

  try {
    const response = await fetch(parsedUrl.toString(), {
      method: 'GET',
      headers: opts.headers,
      signal: controller.signal,
      redirect: opts.followRedirects ? 'follow' : 'manual',
    });

    clearTimeout(timeoutId);

    const headers = headersToObject(response.headers);
    const contentType = response.headers.get('content-type') || undefined;

    // Check response size before reading
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > opts.maxSize) {
      return {
        success: false,
        url,
        status: response.status,
        statusText: response.statusText,
        headers,
        contentType,
        error: `Response too large: ${contentLength} bytes exceeds max size of ${opts.maxSize} bytes`,
        errorType: 'PARSE_ERROR',
        timing: {
          startTime,
          endTime: Date.now(),
          duration: Date.now() - startTime,
        },
      };
    }

    // Read response body
    let data: string;
    try {
      data = await response.text();
    } catch (err) {
      return {
        success: false,
        url,
        status: response.status,
        statusText: response.statusText,
        headers,
        contentType,
        error: `Failed to read response body: ${err instanceof Error ? err.message : 'Unknown error'}`,
        errorType: 'PARSE_ERROR',
        timing: {
          startTime,
          endTime: Date.now(),
          duration: Date.now() - startTime,
        },
      };
    }

    const endTime = Date.now();

    // Check for HTTP errors
    if (!response.ok) {
      return {
        success: false,
        url,
        status: response.status,
        statusText: response.statusText,
        headers,
        contentType,
        data,
        error: `HTTP ${response.status}: ${response.statusText}`,
        errorType: 'HTTP_ERROR',
        timing: {
          startTime,
          endTime,
          duration: endTime - startTime,
        },
      };
    }

    return {
      success: true,
      url,
      status: response.status,
      statusText: response.statusText,
      headers,
      contentType,
      data,
      timing: {
        startTime,
        endTime,
        duration: endTime - startTime,
      },
    };
  } catch (err) {
    clearTimeout(timeoutId);

    const error = err instanceof Error ? err : new Error(String(err));
    const endTime = Date.now();

    // Handle abort (timeout)
    if (error.name === 'AbortError') {
      return {
        success: false,
        url,
        error: `Request timed out after ${opts.timeout}ms`,
        errorType: 'TIMEOUT',
        timing: {
          startTime,
          endTime,
          duration: endTime - startTime,
        },
      };
    }

    const errorType = classifyError(error);

    return {
      success: false,
      url,
      error: error.message,
      errorType,
      timing: {
        startTime,
        endTime,
        duration: endTime - startTime,
      },
    };
  }
}

/**
 * Fetch JSON from a URL
 */
export async function fetchJson<T = unknown>(url: string, options?: FetchOptions): Promise<FetchResult & { json?: T }> {
  const result = await fetchUrl(url, options);

  if (!result.success || !result.data) {
    return result;
  }

  try {
    const json = JSON.parse(result.data) as T;
    return { ...result, json };
  } catch {
    return {
      ...result,
      success: false,
      error: 'Failed to parse response as JSON',
      errorType: 'PARSE_ERROR',
    };
  }
}
