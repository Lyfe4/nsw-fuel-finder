import { skipToken, useQuery } from '@tanstack/react-query';

import { fetchPrices, type PriceSearch } from '@/lib/api';

/** Prices for a search, or nothing while there is no search to run. */
export function usePrices(search: PriceSearch | null) {
  return useQuery({
    queryKey: ['prices', search],
    queryFn: search ? ({ signal }) => fetchPrices(search, signal) : skipToken,
  });
}
