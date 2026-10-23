import { useCallback, useRef, useState } from 'react';

import type { LatLng } from '../../../shared/geo';

export type GeolocationStatus =
  'idle' | 'locating' | 'located' | 'denied' | 'unavailable' | 'timeout' | 'unsupported';

export interface GeolocationState {
  status: GeolocationStatus;
  /** Precise, and kept in memory only: it never goes into a URL or a request. */
  position: LatLng | null;
}

/**
 * - Low accuracy: a fuel search needs the suburb, not the driveway, and a
 *   network fix arrives in a second where GPS can take ten.
 * - A fix up to five minutes old is fine for the same reason.
 * - Ten seconds before giving up, so "Finding your location..." never hangs.
 */
export const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 5 * 60_000,
  timeout: 10_000,
};

const STATUS_BY_ERROR: Record<number, GeolocationStatus> = {
  1: 'denied', // PERMISSION_DENIED
  2: 'unavailable', // POSITION_UNAVAILABLE
  3: 'timeout', // TIMEOUT
};

/**
 * Asks for the device's position when `locate` is called - never on load: a
 * permission prompt nobody asked for is the fastest way to a "Block".
 */
export function useGeolocation(onLocated: (position: LatLng) => void) {
  const [state, setState] = useState<GeolocationState>({ status: 'idle', position: null });
  // Each request gets a number; an answer to an older one (the user typed a
  // suburb while the browser was still asking) is ignored.
  const latest = useRef(0);

  const locate = useCallback(() => {
    const id = ++latest.current;
    if (!('geolocation' in navigator)) {
      setState({ status: 'unsupported', position: null });
      return;
    }
    setState((previous) => ({ status: 'locating', position: previous.position }));
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (id !== latest.current) return;
        const position = { latitude: coords.latitude, longitude: coords.longitude };
        setState({ status: 'located', position });
        onLocated(position);
      },
      (error) => {
        if (id !== latest.current) return;
        setState({ status: STATUS_BY_ERROR[error.code] ?? 'unavailable', position: null });
      },
      GEOLOCATION_OPTIONS,
    );
  }, [onLocated]);

  /** Forget any pending request and its outcome: the user searched another way. */
  const reset = useCallback(() => {
    latest.current++;
    setState((previous) =>
      previous.status === 'idle' ? previous : { status: 'idle', position: previous.position },
    );
  }, []);

  return { ...state, locate, reset };
}
