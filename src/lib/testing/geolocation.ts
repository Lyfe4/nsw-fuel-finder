import { act } from '@testing-library/react';
import { vi } from 'vitest';

type Success = (position: GeolocationPosition) => void;
type Failure = (error: GeolocationPositionError) => void;

/**
 * A controllable navigator.geolocation. jsdom has none at all - which is
 * also how the "unsupported" case is tested - so this defines one for the
 * test, and vitest.setup.ts removes it afterwards. Each request waits until
 * the test answers it.
 */
export function fakeGeolocation() {
  const pending: { success: Success; failure: Failure; options: PositionOptions | undefined }[] =
    [];
  const getCurrentPosition = vi.fn(
    (success: Success, failure?: Failure | null, options?: PositionOptions) => {
      pending.push({ success, failure: failure ?? (() => undefined), options });
    },
  );
  Object.defineProperty(navigator, 'geolocation', {
    value: { getCurrentPosition },
    configurable: true,
  });

  return {
    getCurrentPosition,
    /** Answer request `call` (default: the latest) with a position. */
    succeed(latitude: number, longitude: number, call = pending.length - 1) {
      act(() => {
        pending[call]?.success({ coords: { latitude, longitude } } as GeolocationPosition);
      });
    },
    /** Answer with an error: 1 denied, 2 unavailable, 3 timeout. */
    fail(code: 1 | 2 | 3, call = pending.length - 1) {
      act(() => {
        pending[call]?.failure({ code } as GeolocationPositionError);
      });
    },
  };
}
