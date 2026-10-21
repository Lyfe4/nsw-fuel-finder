import type { ApiErrorBody, ApiErrorCode } from '../../../shared/api';

/**
 * Status codes for each error we return. The client's mistakes are 4xx; a
 * failure between us and API.NSW is 5xx, including an upstream 401 - that is
 * our credentials being wrong, not the caller's, so passing a 401 through
 * would tell the browser to fix something it cannot touch.
 */
const STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  not_found: 404,
  method_not_allowed: 405,
  not_configured: 500,
  upstream_auth: 502,
  upstream_error: 502,
  upstream_rate_limited: 503,
  upstream_unavailable: 503,
  upstream_timeout: 504,
  internal_error: 500,
};

/** An error that already knows how it should look to the client. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ApiError';
    this.code = code;
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export function json(body: unknown, status: number, cacheControl: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
      // Data from a third party, served as JSON. Stops a browser from ever
      // sniffing it into something executable.
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function errorResponse(error: ApiError): Response {
  const body: ApiErrorBody = { error: { code: error.code, message: error.message } };
  // Errors are never cached: a blip upstream must not be pinned at the CDN.
  const response = json(body, error.status, 'no-store');
  if (error.code === 'method_not_allowed') response.headers.set('Allow', 'GET');
  if (error.code === 'upstream_rate_limited' || error.code === 'upstream_unavailable') {
    response.headers.set('Retry-After', '60');
  }
  return response;
}
