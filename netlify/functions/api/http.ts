import type { ApiErrorBody, ApiErrorCode } from '../../../shared/api';

const STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  not_found: 404,
  method_not_allowed: 405,
  location_not_found: 404,
  // 409: the request is fine but has more than one answer; `candidates` lists them.
  ambiguous_location: 409,
  snapshot_unavailable: 503,
  internal_error: 500,
};

/** An error that already knows how it should look to the client. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly candidates: string[] | undefined;

  constructor(code: ApiErrorCode, message: string, options?: { candidates?: string[] }) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.candidates = options?.candidates;
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
  const body: ApiErrorBody = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.candidates ? { candidates: error.candidates } : {}),
    },
  };
  // Errors are never cached: a missing snapshot must not be pinned at the CDN.
  const response = json(body, error.status, 'no-store');
  if (error.code === 'method_not_allowed') response.headers.set('Allow', 'GET');
  if (error.code === 'snapshot_unavailable') response.headers.set('Retry-After', '60');
  return response;
}
