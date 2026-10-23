import { keepPreviousData, skipToken, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { fetchPlaceSuggestions } from '@/lib/api';

/** Long enough to skip the keystrokes of a fast typist, short enough to feel live. */
export const SUGGESTION_DEBOUNCE_MS = 200;
const MIN_LENGTH = 2;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [value, ms]);
  return debounced;
}

/**
 * Suggestions for what is typed so far. They only change with a deploy, so a
 * query once answered is never asked again in this visit; the previous list
 * stays up while the next one loads, so the list does not flicker per key.
 */
export function usePlaceSuggestions(input: string): string[] {
  const query = useDebounced(input.trim(), SUGGESTION_DEBOUNCE_MS);
  const enabled = query.length >= MIN_LENGTH;
  const { data } = useQuery({
    queryKey: ['places', query],
    queryFn: enabled ? ({ signal }) => fetchPlaceSuggestions(query, signal) : skipToken,
    staleTime: Infinity,
    retry: false,
    placeholderData: keepPreviousData,
  });
  return enabled && input.trim().length >= MIN_LENGTH ? (data?.suggestions ?? []) : [];
}
