/**
 * Why an upstream call failed. These never reach the browser: the API
 * function answers from the snapshot, and only the scheduled job talks to
 * API.NSW. They exist so the job's log and `meta/last-run` say what happened.
 */
export type UpstreamErrorKind =
  | 'not_configured'
  | 'credentials_rejected'
  | 'credentials_locked'
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'request_rejected'
  | 'bad_response'
  /** A well-formed answer missing most stations: kept out of the snapshot. */
  | 'partial_response'
  /** Queensland's reference data: the last refresh failed under an hour ago (round 16). */
  | 'backing_off';

export class UpstreamError extends Error {
  readonly kind: UpstreamErrorKind;

  constructor(kind: UpstreamErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'UpstreamError';
    this.kind = kind;
  }
}

export function statusError(status: number, what: string): UpstreamError {
  if (status === 429) return new UpstreamError('rate_limited', `${what}: HTTP 429`);
  if (status >= 500) return new UpstreamError('unavailable', `${what}: HTTP ${String(status)}`);
  return new UpstreamError('request_rejected', `${what}: HTTP ${String(status)}`);
}
