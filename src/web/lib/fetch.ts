/**
 * HTTP Fetch Utility for the dashboard
 */

export type FetchErrorType =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'DNS_ERROR'
  | 'CONNECTION_REFUSED'
  | 'SSL_ERROR'
  | 'INVALID_URL'
  | 'HTTP_ERROR'
  | 'PARSE_ERROR'
  | 'UNKNOWN';

export interface FetchResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errorType?: FetchErrorType;
  statusCode?: number;
  statusText?: string;
  headers?: Record<string, string>;
  responseTime: number;
  url?: string;
}

export interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';
  headers?: Record<string, string>;
  body?: string | object;
  timeout?: number;
}

const DEFAULT_TIMEOUT = 30000;

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
  if (message.includes('ssl') || message.includes('certificate')) {
    return 'SSL_ERROR';
  }
  if (message.includes('invalid url')) {
    return 'INVALID_URL';
  }

  return 'UNKNOWN';
}

export async function fetchUrl<T = unknown>(
  url: string,
  options: FetchOptions = {}
): Promise<FetchResult<T>> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeout = DEFAULT_TIMEOUT,
  } = options;

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const fetchOptions: RequestInit = {
      method,
      headers: {
        'User-Agent': 'Omega-Arbiter/1.0',
        ...headers,
      },
      signal: controller.signal,
    };

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

    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);

    const responseTime = Date.now() - startTime;

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    let data: T | undefined;
    const contentType = response.headers.get('content-type') || '';

    try {
      const text = await response.text();
      if (contentType.includes('application/json')) {
        data = JSON.parse(text) as T;
      } else {
        data = text as unknown as T;
      }
    } catch {
      // Ignore parse errors
    }

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        errorType: 'HTTP_ERROR',
        statusCode: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        data,
        responseTime,
        url,
      };
    }

    return {
      success: true,
      data,
      statusCode: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      responseTime,
      url,
    };

  } catch (error) {
    const responseTime = Date.now() - startTime;
    let errorMsg: string;
    let errorType: FetchErrorType;

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        errorMsg = `Request timed out after ${timeout}ms`;
        errorType = 'TIMEOUT';
      } else {
        errorType = classifyError(error);
        errorMsg = error.message;
      }
    } else {
      errorMsg = String(error);
      errorType = 'UNKNOWN';
    }

    return {
      success: false,
      error: errorMsg,
      errorType,
      responseTime,
      url,
    };
  }
}

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
