import { QueryClient } from '@tanstack/react-query';

import { ApiRequestError } from '@/lib/api';

/**
 * Retry only what retrying can fix: no connection, or no snapshot yet (503,
 * the API's own Retry-After case). A 4xx is an answer, not a failure - "no
 * such suburb" will not change on the third attempt.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return false;
  return (error.status === 0 || error.status === 503) && failureCount < 3;
}

export function createQueryClient(options: { retry?: boolean } = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: options.retry === false ? false : shouldRetry,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        // The API is cached for a minute at the edge, so asking sooner
        // returns the same answer.
        staleTime: 60_000,
        // A tab left open picks up the next half-hourly snapshot on return.
        refetchOnWindowFocus: true,
      },
    },
  });
}
